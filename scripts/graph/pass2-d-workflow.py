# Pass 2 D 판정을 agy run_workflow로 돌리는 스크립트(C 판정 스크립트를 따른다, 2026-11-25).
# agy 감독관이 run_workflow(ScriptPath=<이 파일 절대 경로>, Args={"run": "pilot", "wave": N})로 실행한다.
# Args: run(필수 아님, 기본 wf), wave(그 회차 묶음만), bundles(묶음 ID 목록, wave와 함께 쓰면 둘 다 맞는 것만), max_followups
# 일반 python3로는 돌지 않는다(agent·parallel·log·args는 run_workflow가 넣어 준다).
#
# - 묶음마다 새 맥락의 판정자 하나(model="inherit": 감독관과 같은 모델). 판정자끼리, 스크립트와 맥락을 나누지 않는다
# - 판정자 지시문은 GRAPH_RAG_PASS2_C_PILOT.md 1절에서 자기 점검 네 줄을 뺀 것이다(규칙 3.4~3.6절에 들어감, 2026-11-20).
#   다른 점은 --run 값과 6번 보고 줄(finish 도구로 보고)이다
# - 판정자가 보고한 뒤 스크립트가 status(읽기 전용)로 통과 여부를 확인한다. [done]이 아니면 같은 판정자에게 다시 맡긴다(최대 MAX_FOLLOWUPS번)
#   validate는 스크립트가 돌리지 않는다(검증 기록이 늘어 파일럿과 검증 횟수를 비교할 수 없게 된다)
# - 묶음 하나가 예외로 끝나도 나머지는 계속한다(parallel은 예외 하나에 전부 취소하므로 묶음마다 잡는다)
# - 판정자 보고·턴 수·시간은 <run root>/workflow/<bundle_id>.json에 쓰고, 감독관에게는 요약만 출력한다

import json
import os
import subprocess
import time

RUN = args.get("run", "pilot")
RUN_DIRS = {"pilot": "d-pilot", "retest": "d-retest", "main": "d"}
ROOT = os.path.join("data", "graph", "pass2", RUN_DIRS[RUN])
OUT_DIR = os.path.join(ROOT, "workflow")
MAX_FOLLOWUPS = int(args.get("max_followups", 2))

with open(os.path.join(ROOT, "bundles", "plan.json"), encoding="utf-8") as f:
    plan = json.load(f)
only = set(args.get("bundles") or [])
wave = args.get("wave")
if only - {b["bundle_id"] for b in plan["bundles"]}:
    raise ValueError(f"계획에 없는 묶음: {sorted(only - {b['bundle_id'] for b in plan['bundles']})}")
bundles = [
    b for b in plan["bundles"]
    if (not only or b["bundle_id"] in only) and (wave is None or int(b["wave"]) == int(wave))
]
if not bundles:
    raise ValueError(f"고른 묶음이 없다(wave={wave}, bundles={sorted(only)})")

JUDGE = """너는 GraphRAG Pass 2 D 판정자다. 묶음 하나만 판정한다.
1. docs/graphrag/GRAPH_RAG_PASS2_D_RULES.md를 읽어라. 이 규칙이 전부다.
   명세·설계·감독관 지시서·scripts 소스·다른 묶음의 출력·감사 파일은 읽지 마라.
2. 입력 {input}, 발췌 {script}. 단위(units)는 엔티티 쌍이고 메모(memos)는 그 쌍의 Pass 1 관계 메모다.
   메모를 하나도 빠뜨리지 마라. 메모마다 관계 기록(candidate_links의 memo_ids)이나 excluded_memos 중 한쪽에 둔다.
   relation_or_change·호칭 요약·앞 단계 맥락·ambiguous_endpoints는 근거가 아니다. 원문으로 확인하라.
   공개 순서로 관계 변화를 잇지 마라. 작중 순서는 원문 근거(script)나 공식 연표(official_timeline)로만, 없으면 unknown이다.
   회고·회상 기록을 순서에 쓰려면 성립 시점 anchor를 적는다.
3. 출력 {output} 하나만 써라. schema_version은 pass2-0.1.0, bundle_id는 {bundle_id}다.
   출력이 너무 길면 부분 결과 파일을 만들어 node scripts/graph/pass2-d.mjs append-shard {bundle_id} --from=<파일> --run={run} 으로 덧붙인다.
4. 원문은 show, 단위·메모 요약은 cand, ID는 entity로 확인한다.
   검색은 node scripts/graph/pass2-d.mjs grep <검색어> --bundle={bundle_id} --unit=<unit_id> [--title=<title_id>[,…]] --run={run} 을 쓴다.
   쌍당 고유 검색어 최대 3개, 묶음 전체 40개, 같은 검색어·title·offset 재실행 금지.
5. {validate}를 그대로 실행한다. 실패하면 최대 3회 수정·재시도한다.
   경고는 원문으로 확인하고 남긴 이유를 보고하라. 통과하려고 근거를 지어내거나 규칙을 고치지 마라.
6. 규칙 7절 형식의 보고를 finish 도구로 한 번에 내라."""

REPORT = {"type": "string"}


def status_line(bundle_id):
    out = subprocess.run(
        ["node", "scripts/graph/pass2-d.mjs", "status", f"--run={RUN}"],
        capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        if f"] {bundle_id} " in line:
            return line.strip()
    return None


async def judge(b):
    bid = b["bundle_id"]
    rec = {"bundle_id": bid, "started_at": time.time(), "turns": [], "error": None}
    prompt = JUDGE.format(run=RUN, **b)
    judge_agent = agent(prompt, schema=REPORT, role=f"D 판정자 {bid}", model="inherit")
    try:
        report = await judge_agent("지시대로 이 묶음을 판정하라.")
        rec["turns"].append({"kind": "first", "report": report, "status_after": status_line(bid)})
        for _ in range(MAX_FOLLOWUPS):
            line = rec["turns"][-1]["status_after"]
            if line and line.startswith("[done]"):
                break
            report = await judge_agent(
                f"감독 스크립트가 확인해 보니 이 묶음이 통과 상태가 아니다: {line}\n"
                f"{b['validate']}를 실행해 오류를 고치고(지시 5번), 규칙 7절 형식으로 다시 보고하라."
            )
            rec["turns"].append({"kind": "followup", "report": report, "status_after": status_line(bid)})
    except Exception as e:  # 한 묶음의 실패가 다른 묶음을 취소하지 않게 한다
        rec["error"] = repr(e)
    rec["ended_at"] = time.time()
    rec["minutes"] = round((rec["ended_at"] - rec["started_at"]) / 60, 1)
    rec["final_status"] = status_line(bid)
    with open(os.path.join(OUT_DIR, f"{bid}.json"), "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    return {
        "bundle_id": bid,
        "final_status": rec["final_status"],
        "judge_turns": len(rec["turns"]),
        "minutes": rec["minutes"],
        "error": rec["error"],
        "first_line": (rec["turns"][-1]["report"].splitlines() or [""])[0] if rec["turns"] else None,
    }


os.makedirs(OUT_DIR, exist_ok=True)
phase(f"D 판정 ({RUN}{'' if wave is None else f' 회차 {wave}'}, {len(bundles)}묶음)")
log(f"묶음 {len(bundles)}개 동시 실행, 재요청 최대 {MAX_FOLLOWUPS}번")
results = await parallel(bundles, judge)
summary = {"run": RUN, "bundles": results}
with open(os.path.join(OUT_DIR, "summary.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False, indent=2))
