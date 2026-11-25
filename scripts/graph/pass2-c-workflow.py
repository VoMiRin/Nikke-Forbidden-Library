# Pass 2 C 판정을 agy run_workflow로 돌리는 스크립트(실행 방식 시험 2026-11-19, 본 실행 2026-11-20).
# agy 감독관이 run_workflow(ScriptPath=<이 파일 절대 경로>, Args={"run": "main", "wave": N})로 실행한다.
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

RUN = args.get("run", "wf")
RUN_DIRS = {"pilot": "c-pilot", "retest": "c-retest", "wf": "c-wf", "main": "c"}
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

JUDGE = """너는 GraphRAG Pass 2 C 판정자다. 묶음 하나만 판정한다.
1. docs/graphrag/GRAPH_RAG_PASS2_C_RULES.md를 읽어라. 이 규칙이 전부다.
   명세·설계·감독관 지시서·scripts 소스·다른 묶음의 출력·답안은 읽지 마라.
2. 입력 {input}, 발췌 {script}, 묶음 밖 단서 색인 {clues}.
   units를 하나도 빠뜨리지 마라. 단위마다 짝을 찾고, 단서 쪽으로 이은 연결이 없는 단위는 unlinked에 자기 상태를 적어라.
   공개 쪽으로만 쓰인 단위도 unlinked에 적는다(자기 의문이 남으면 짝 없음, 없으면 단서 아님).
   먼저 단서가 남긴 질문을 원문에서 특정하라. 특정할 수 없으면 단서 아님이다. 미래를 가리키는 말만으로는 의문이 아니다(3.5절).
   같은 낱말이 두 장면에 나오기만 한 것은 잇지 않는다. 공개 쪽 원문이 그 질문에 답할 때만 잇는다(3.2절).
   같은 대상·판단 보류의 rationale에는 질문: / 답: / 근거:를 모두 적어라(3.4절). 짝 없음에는 note에 남은 의문을 적어라.
   일부 의문만 풀렸으면 이은 연결과 함께 남은 의문을 짝 없음(note)으로 적어라.
   suggested_pairs, official_key, pass1_detail, pass1_hints, 색인은 근거가 아니다. 원문으로 확인하라.
   색인에서 짝일 것 같은 단서는 show로 그 장면을 읽고 확인한 뒤 ref: "item"으로 이어라. ID는 show 머리말에서 옮긴다.
3. 출력 {output} 하나만 써라. schema_version은 pass2-0.1.0, bundle_id는 {bundle_id}다.
   같은 대상·판단 보류는 양쪽 끝마다 그 끝 범위와 겹치고 앞뒤 2줄 안에 드는 원문 인용을 적어라.
   단서 항목이 아닌 공개 줄은 ref: "lines"(15줄까지, scan_id 또는 null)로 적어라. 단서 하나 안에 완전히 드는 줄이면 ref: "item"이 좋다.
   다른 대상은 제시된 짝을 기각할 때만, 적고 싶을 때만 적는다.
4. 제시 쌍과 C-0 줄 전부는 cand, 원문은 show, ID는 entity로 확인한다.
   검색은 node scripts/graph/pass2-c.mjs grep <검색어> --bundle={bundle_id} --unit=<item_id> [--title=<title_id>[,…]] --run={run} 을 쓴다.
   단위당 고유 검색어 최대 3개, 묶음 전체 40개, 같은 검색어·title·offset 재실행 금지. 잘린 결과는 --offset으로 이어 본다.
   한 글자 검색어는 --title을 정할 때만 쓴다. 예산을 다 쓰고 짝을 못 찾으면 짝 없음 note를 [검색 예산 소진]으로 시작한다.
   검색어를 실행하기 전에 그 단위에 쓴 고유 검색어 수를 세라. 보고의 grep 목록에는 실제로 실행한 검색어를 빠짐없이 적어라.
5. {validate}를 그대로 실행한다. 실패하면 최대 3회 수정·재시도한다.
   경고는 원문으로 확인하고 남긴 이유를 보고하라. 통과하려고 근거를 지어내거나 규칙을 고치지 마라.
6. 규칙 7절 형식의 보고를 finish 도구로 한 번에 내라."""

# 증분 회차(GRAPH_RAG_INCREMENT_DESIGN.md 4.6): 재확인 단위가 있는 묶음에만 붙인다. 규칙 파일은 묶음 도장에 들어가므로 고치지 않는다
REVISIT = """
7. 재확인 단위: units 중 revisit가 있는 단위(발췌 머리말 다음 줄 "(재확인 단위 — …)")는 본 실행에서 이미 판정한 옛 미해결 단서다.
   새 대본이 더해져 짝이 생겼을 수 있어 이 묶음이 그 단위의 판정을 새로 맡는다. 지난 판정(짝 없음·보류, 남은 의문, 단서 쪽 연결)은 근거가 아니다.
   다른 단위와 똑같이 처음부터 판정하라. 짝을 찾으면 단서 쪽으로 잇고, 일부만 풀렸으면 남은 의문을 짝 없음 note로 적는다.
   짝이 없으면 지난 남은 의문을 원문으로 다시 확인해 짝 없음으로 적는다. 지난 단서 쪽 연결은 이 묶음의 판정으로 바뀌므로, 여전히 맞으면 다시 적어라."""

REPORT = {"type": "string"}


def status_line(bundle_id):
    out = subprocess.run(
        ["node", "scripts/graph/pass2-c.mjs", "status", f"--run={RUN}"],
        capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        if f"] {bundle_id} " in line:
            return line.strip()
    return None


async def judge(b):
    bid = b["bundle_id"]
    rec = {"bundle_id": bid, "started_at": time.time(), "turns": [], "error": None}
    prompt = JUDGE.format(run=RUN, **b) + (REVISIT if b.get("revisit_units") else "")
    judge_agent = agent(prompt, schema=REPORT, role=f"C 판정자 {bid}", model="inherit")
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
phase(f"C 판정 ({RUN}{'' if wave is None else f' 회차 {wave}'}, {len(bundles)}묶음)")
log(f"묶음 {len(bundles)}개 동시 실행, 재요청 최대 {MAX_FOLLOWUPS}번")
results = await parallel(bundles, judge)
summary = {"run": RUN, "bundles": results}
with open(os.path.join(OUT_DIR, "summary.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False, indent=2))
