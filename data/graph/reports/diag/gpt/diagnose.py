#!/usr/bin/env python3
"""Independent Pass 1 diagnosis. Python stdlib + Node.js; frozen input only.

Run: python3 diagnose.py /tmp/frozen-input [--complete]
No full validator, manifest builder, Pass 2 or data mutation is invoked.
"""
import argparse
import collections as C
import hashlib
import json
import pathlib
import re
import subprocess
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

MANIFEST_HASH = '335ccf60b510e5a31797944cf915446853871f26b76db7a9e0e360119f5e134a'
COMMIT = '0dee5991f2c67bf8eaf307c3cc6eeecfe8ba5767'
CREATED_AT = '2026-11-02 18:28:53 KST'
OUTPUT = pathlib.Path(__file__).resolve().parent
PARTS = ['present_in_scene', 'present_silent', 'remote_or_voice_only', 'mentioned_only']
INDEXED = ['unknown_speakers', 'descriptor_speakers', 'relationship_and_lore_notes', 'forms_of_address', 'clues_and_hooks']
UNINDEXED = ['summary', 'events_and_claims', 'choice_branches', 'same_scene_speaker_groups', 'cross_scene_hints', 'reviewed_gaps', 'unregistered_entity_candidates', 'chronology_segments']
REVIEW = {}  # Human/source review decisions, filled explicitly below.

def reviewed(q, key, verdict, reason, *locations):
    REVIEW[(q,key)] = (verdict,reason,[dict(scene_id=s,line_start=a,line_end=b) for s,a,b in locations])

# The 30 Q3 objects read directly, selected by non-mentioned fields first,
# then distinct (field, label), Unicode label and scene order.
Q3_CHECKS = [
 ('rupee_wintershopper_01','remote_or_voice_only[3]',30,33),
 ('persona_on_frontline_03','present_in_scene[2]',12,15),
 ('memories_teller_13','present_silent[1]',154,157),
 ('main_24_21','present_silent[0]',73,76),('pretty_star_14','present_silent[0]',4,7),
 ('랩칠리언_06','present_silent[3]',102,105),('main_30_09','present_silent[0]',142,145),
 ('main_40_13','present_silent[0]',151,154),('star_anis_17','present_silent[0]',189,192),
 ('lion_heart_06','present_silent[0]',1,4),('pretty_star_14','present_silent[1]',4,7),
 ('hospital_01','present_silent[0]',15,18),('lord_for_justice_08','mentioned_only[10]',89,92),
 ('d_00','mentioned_only[3]',24,27),('blabla_d_003','mentioned_only[0]',11,14),
 ('lord_for_justice_13','mentioned_only[0]',8,11),('chapter_49_06','mentioned_only[18]',137,140),
 ('cinderella_03','mentioned_only[4]',58,61),('boom_the_ghost_15','mentioned_only[4]',6,9),
 ('main_46_04','mentioned_only[16]',69,72),('star_anis_14','mentioned_only[1]',29,32),
 ('2호_쉘터_관리계정_00','mentioned_only[6]',191,194),('goddess_fall_02','mentioned_only[9]',128,131),
 ('main_45_10','mentioned_only[20]',192,195),('main_42_01','mentioned_only[7]',53,56),
 ('boom_the_ghost_15','mentioned_only[1]',3,6),('project_matis_06','mentioned_only[9]',50,53),
 ('wave_to_you_00','mentioned_only[6]',73,76),('main_46_04','mentioned_only[15]',69,72),
 ('main_35_02','mentioned_only[13]',165,168)]
for sid,path,a,b in Q3_CHECKS:
    hold = sid in {'rupee_wintershopper_01','memories_teller_13','랩칠리언_06'}
    reviewed('Q3',f'shard:{sid}#participants.{path}','판단 보류' if hold else '연결 누락 의심',
             '원문에 표기는 있으나 익명 핸들·일반 지칭·랩쳐 종류와 등록 개체가 같은 정체인지 근거가 부족하다.' if hold else
             '원문에서 등록 이름을 해당 인물/개체 지칭으로 확인했으나 entity_id가 null이다. 정규화 등록 ID와 surface 키 분산을 보수 시 재확인해야 한다.',(sid,a,b))

# Q5: absent-everywhere candidates first, candidate-only targets next,
# then distinct source surface in Unicode order; 30 findings total.
Q5_CHECKS = [
 ('blabla_n102_004','N102',1,4,'정상','메신저 대화방 제목이다. 이 줄만으로 별도 인물이 추출되어야 한다고 볼 수 없고 참여자 앤은 이미 색인되어 있다.'),
 ('golden_coin_rush_04','나가',164,167,'정상','나가요라는 동사 용례로 인물 이름 검출의 거짓 양성이다.'),
 ('blabla_claymore_002','마린',1,4,'판단 보류','대화방 제목에만 이름이 있다. 제목만으로 인물 언급 추출을 요구할지는 추가 문맥 확인이 필요하다.'),
 ('main_42_07','검은 소녀',203,206,'판단 보류','장면의 특정 존재를 묘사하지만 다른 색인 표기와 동일 대상인지 이 짧은 범위만으로 결정하지 않는다.'),
 ('phantom_thief_vs_detective_02','괴도 미란다',52,55,'정상','원문이 미란다의 위장 역할명을 설명한다. 미란다 자체의 장면 흔적은 참여자에 있다. 별칭 키 분산과 대상 전체 누락은 구별한다.'),
 ('juvenile_days_05','기숙사',74,77,'연결 누락 의심','인물들이 실제 돌아간 장소가 사건/후보 필드에만 있고 색인되는 필드에는 없다.'),
 ('guillotine_01','길로틴 드 메피스토',2,5,'판단 보류','결투 상대의 확장 이름으로 보이나 길로틴 색인과의 동일성은 추가 근거가 필요하다.'),
 ('alice_wonderlandbunny_00','눈의 여왕님',4,7,'판단 보류','인물의 별칭으로 보이나 다른 색인 인물과의 동일성을 이 범위로 확정할 수 없다.'),
 ('hongryeon_goddeath_00','도령',49,52,'판단 보류','실행력을 칭찬받는 인물의 호칭이다. 다른 색인 대상과의 동일성 검토가 필요하다.'),
 ('clay_more_10','루비',147,150,'연결 누락 의심','대결한 인물의 고유명이 사건과 후보에만 남고 색인 필드에는 없다.'),
 ('main_44_09','엔더슨의 사무실',1,4,'연결 누락 의심','장면 배경 장소가 요약·사건·후보에만 있고 장소 표기로 색인되는 내용에는 없다.'),
 ('main_44_07','유사 인간',51,54,'판단 보류','특정 집단에 대한 화자의 지칭이나 헬레틱 등의 기존 색인 표기와의 관계가 불명확하다.'),
 ('quency_01','탈옥의 신',78,81,'정상','원문이 퀀시의 별명이라고 명시한다. 퀀시 자체는 참여자로 색인되어 있어 대상 전체 누락은 아니다.'),
 ('eden_spear_11','해파리 녀석',89,92,'판단 보류','응답에서 리버렐리오를 거론한다. 별칭 키 손실과 대상 전체 누락을 구별하려면 동일성 검토가 필요하다.'),
 ('긴급뉴스대본_FB_3_final_2.pdf_01','FB',4,7,'판단 보류','대본 편집 주체가 사건에만 있다. 레지스트리의 FB와 동일 인물인지 짧은 편집 메모만으로 판정하지 않는다.'),
 ('blabla_noise_003','PD',51,54,'판단 보류','특정 방송의 PD 언급이지만 등록 char_PD와의 동일성은 불명이다.'),
 ('ether_04','간수',110,113,'정상','노예 간수처럼이라는 비유이지 등록 인물 간수를 가리킨다는 근거가 없다.'),
 ('main_30_08','관짝이',9,12,'판단 보류','선택지에 있는 호칭이다. 다른 색인 인물의 별칭인지 후속 확인이 필요하다.'),
 ('pretty_star_03','교사',117,120,'판단 보류','교사라는 역할 언급이지만 등록 char_교사와 같은 인물인지 불명이다.'),
 ('great_villain_union_11','그레그레',72,75,'정상','그레이브가 자기 역할명을 그레그레라고 밝힌다. 그레이브는 이미 참여자로 색인되어 있다.'),
 ('maxwell_00','그레이',75,78,'정상','색상을 나타내는 그레이 페이스로 인물 용례가 아니다.'),
 ('absolute_12','기계음',21,24,'정상','이동하는 기계의 소리 묘사이며 등록 인물 화자와 동일하다는 근거가 없다.'),
 ('harran_04','네온',85,88,'정상','반짝이는 네온은 조명 묘사이다.'),
 ('bready_02','노이즈',105,108,'정상','적당한 노이즈는 소음/음향을 가리킨다.'),
 ('blabla_centi_004','노인',36,39,'판단 보류','노인 공경이라는 일반 표현으로, 특정 등록 인물과의 연결 여부는 보류한다.'),
 ('library_03','라라',89,92,'정상','노래의 음절이다.'),
 ('blabla_emma_006','로즈',80,83,'정상','향 종류를 뜻한다.'),
 ('rupee_wintershopper_01','루루',136,139,'정상','루루팡을 끊어 읽은 것으로 루루라는 별도 인물의 누락을 뜻하지 않는다.'),
 ('ark_ranger_00','마나',36,39,'정상','보나 마나라는 문법적 표현이다.'),
 ('jinx_player_08','마스터',15,18,'정상','게임 마스터라는 루주의 역할명이며 등록된 별도 인물 마스터의 누락으로 볼 수 없다.')]
for sid,surface,a,b,verdict,reason in Q5_CHECKS:
    reviewed('Q5',f'missing:{sid}#{surface}',verdict,reason,(sid,a,b))

for surface,sid,a,b in [('아나키오르','main_30_09',144,146),('식스오','main_30_13',55,57),('그레텔','main_42_01',135,137),('티미','lion_heart_03',107,109),('베히모스','main_31_11',33,35),('헨젤','main_42_01',135,137)]:
    reviewed('Q4',f'file:data/graph/unregistered_entity_candidates.json#character::{surface}','연결 누락 의심','원문이 등록 이름을 인물/개체로 사용한다. 해당 장면이 surface 버킷에만 있어 등록 ID 한 키로는 놓친다.',(sid,a,b))
for names,locs in [(['중앙 정부','중앙정부'],[('main_01_07',47,49),('main_14_17',26,28)]),(['아우터 림','아우터림'],[('main_04_16',46,48),('clay_more_12',121,123)]),(['전초 기지','전초기지'],[('main_02_09',18,20),('main_13_12',106,108)])]:
    reviewed('Q4','group:'+'|'.join(sorted(names)),'연결 누락 의심','원문 유형 대표에서 같은 조직/지역/배속지 이름의 띄어쓰기 변형을 확인했다. 한 surface 키로는 다른 표기의 장면이 빠진다.',*locs)
reviewed('Q4','group:지휘관 실|지휘관실','판단 보류','장화가 찾는 지휘관실과 주인공의 지휘관실이 같은 물리적 장소라는 근거가 없다. 공백 제거만으로 병합하지 않는다.',('new_year_new_sword_11',4,6),('main_02_11',25,27))

def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(s or ''))).casefold()

def strings(obj, prefix=''):
    if isinstance(obj, str):
        yield prefix, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in {'item_id','scene_id','title_id','category','source_file','source_sha256','unknown_id'}:
                yield from strings(v, f'{prefix}.{k}' if prefix else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from strings(v, f'{prefix}[{i}]')

def objects(s):
    for field in PARTS:
        for i, obj in enumerate(s['participants'][field]):
            yield f'participants.{field}[{i}]', field, obj
    obj = s['participants'].get('document_author')
    if obj is not None:
        yield 'participants.document_author', 'document_author', obj
    for field in ['unknown_speakers','descriptor_speakers']:
        for i, obj in enumerate(s[field]):
            if obj.get('resolved_in_same_scene_to') is not None:
                yield f'{field}[{i}].resolved_in_same_scene_to', f'{field}.resolved_in_same_scene_to', obj['resolved_in_same_scene_to']

def at(obj, path):
    for p in re.findall(r'[^.\[\]]+', path):
        obj = obj[int(p)] if p.isdigit() else obj[p]
    return obj

def label(obj):
    return obj.get('speaker_label') or obj.get('surface_text') or obj.get('name') or ''

class Diagnosis:
    def __init__(self, root):
        self.root = root.resolve()
        if tuple(OUTPUT.parts[-5:-1]) == ('data','graph','reports','diag'):
            assert not self.root.is_relative_to(OUTPUT.parents[4]), 'Frozen input must be outside the repository'
        self.graph = self.root/'data/graph'
        assert hashlib.sha256((self.graph/'manifest.json').read_bytes()).hexdigest() == MANIFEST_HASH, 'Manifest hash mismatch: STOP'
        self.manifest = self.read('manifest.json')
        self.meta = self.manifest['scenes']
        self.registry = self.read('entity_registry.json')
        self.roles = self.read('generic_roles.json')
        self.descriptors = self.read('descriptor_review.json')
        self.index = self.read('pass1_index.json')
        self.progress = self.read('progress.json')
        self.candidates = self.read('unregistered_entity_candidates.json')['candidates']
        self.scenes = {}
        self.stale = []
        self.batches = []
        for p in sorted((self.graph/'pass1/shards').glob('batch_*.json')):
            d = json.loads(p.read_text()); batch = d.get('batch_id', p.stem)
            self.batches.append(batch)
            for s in d['scenes']:
                sid = s['scene_id']
                if self.meta[sid]['batch_id'] != batch:
                    self.stale.append((sid,batch)); continue
                assert sid not in self.scenes
                self.scenes[sid] = s
        assert len(self.scenes) == 5560 and set(self.scenes) == set(self.meta)
        self.views = {}
        for p in sorted((self.graph/'pass1/by_title').glob('*.json')):
            for s in json.loads(p.read_text())['scenes']:
                assert s['scene_id'] not in self.views
                self.views[s['scene_id']] = s
        self.names = C.defaultdict(set)
        self.raw_names = C.defaultdict(set)
        for e in self.registry['entities']:
            for name in [e['canonical_name'], *e['surface_labels']]:
                self.names[norm(name)].add(e['entity_id'])
                self.raw_names[name].add(e['entity_id'])
        self.generic = {norm(x['speaker_label']) for x in self.roles['roles']}
        self.findings = []
        self.stats = {}
        self.source = {}
        self.source_checks = []
        for source_file in sorted({x['source_file'] for x in self.meta.values()}):
            for block in re.split(r'^@@@SCRIPT_ID:\s*', (self.root/source_file).read_text(), flags=re.M)[1:]:
                sid, _, body = block.partition('\n')
                body = re.sub(r'^@@@SUB_TITLE:\s*[^\n]*\n?', '', body, count=1, flags=re.I).rstrip('\n')
                sid = sid.strip()
                if sid in self.meta:
                    assert hashlib.sha256(body.encode()).hexdigest() == self.meta[sid]['source_sha256'], f'Source hash: {sid}'
                    self.source[sid] = body.split('\n') if body else []
        assert set(self.source) == set(self.scenes)
        self.index_text = {}
        self.index_ids = {}
        for sid,s in self.scenes.items():
            # Actual merger projections: participant source evidence/context excluded where not copied.
            v = self.views[sid]
            texts = []
            ids = set()
            for field in PARTS:
                for x in v['participants'][field]:
                    ids.add(x.get('entity_id'))
                    texts.append(label(x))
                    if field != 'present_in_scene': texts.append(x.get('quote',''))
                    if field == 'remote_or_voice_only': texts.append(x.get('medium',''))
            for field in INDEXED:
                texts.extend(text for _,text in strings(v[field]))
            # Preserve field boundaries: concatenation must not invent a name.
            self.index_text[sid] = '\0'.join(norm(text) for text in texts)
            self.index_ids[sid] = ids

    def read(self, name):
        return json.loads((self.graph/name).read_text())

    def finding(self, q, key, observed, reason, verdict='판단 보류', sid=None, path=None):
        iid = None
        if sid is not None and path:
            obj = at(self.views[sid],path)
            iid = obj.get('item_id')
            # Nested identity-resolution objects have no own item_id in the merger.
        f = dict(question=q,target_key=key,scene_id=sid,batch_id=self.meta[sid]['batch_id'] if sid else None,
                 field_path=path,item_id=iid,observed=observed,verdict=verdict,reason=reason,source_checked=[])
        review = REVIEW.get((q,key))
        if review:
            f['verdict'], f['reason'], f['source_checked'] = review
        self.findings.append(f)
        return f

    def shard(self,q,sid,path,obs,reason,verdict='판단 보류'):
        return self.finding(q,f'shard:{sid}#{path}',obs,reason,verdict,sid,path)

    def q3(self):
        counts = C.defaultdict(C.Counter)
        ambiguous = C.Counter()
        for sid,s in self.scenes.items():
            for path,field,obj in objects(s):
                keys = [field]
                if field == 'mentioned_only': keys += [field+'.'+('character' if obj['entity_type']=='character' else 'noncharacter')]
                for k in keys: counts[k]['denominator'] += 1
                if obj.get('entity_id') is not None:
                    for k in keys: counts[k]['nonnull'] += 1
                    continue
                name = label(obj); ids = sorted(self.names.get(norm(name), []))
                if field == 'mentioned_only' and obj['entity_type'] != 'character':
                    cls, reason = 'normal_noncharacter','비인물 대상은 명세상 null이다.'
                elif norm(name) in self.generic:
                    cls, reason = 'normal_generic','고정 일반역할/묘사형/미상 라벨 목록과 일치한다.'
                elif ids:
                    cls, reason = 'registered_name','정규화한 등록 이름과 일치하지만 entity_id가 null이다. 원문 미확인 후보는 보류한다.'
                elif field == 'document_author' and (not name or re.search(r'작성자|기록자|녹음자|화자|목소리|발신자|발화자|필자|독백|시점|수신자|포스터|팜플렛|시안|편지|광고|메일', name)):
                    cls, reason = 'normal_anonymous_author','식별된 등록 인물 이름이 아닌 기록물 작성 주체/라벨 없는 목소리로서 null을 허용한다.'
                else:
                    cls, reason = 'unresolved','등록명 및 고정 일반역할과 일치하지 않는다. 미등록 고유명·별칭·일반 지칭을 원문 없이 구별할 수 없어 보류한다.'
                verdict = '정상' if cls.startswith('normal_') else '판단 보류'
                if verdict != '정상':
                    f = self.shard('Q3',sid,path,dict(label=name,entity_id=None,classification=cls,expected_entity_ids=ids,entity_type=obj.get('entity_type')),reason)
                    verdict = f['verdict']; ambiguous[name] += 1
                for k in keys:
                    counts[k]['null'] += 1; counts[k][cls] += 1; counts[k][verdict] += 1
        self.stats['Q3'] = {'fields':dict(counts),'unresolved_top':ambiguous.most_common(20)}

    def q1(self):
        labels = {'기계음','아주머니','마스터','진행자','자산가'}
        extra = {
            ('hospital_05','participants.present_in_scene[4]'):(26,35,'오류 의심'),
            ('cocoa_04','participants.present_in_scene[4]'):(73,82,'오류 의심'),
            ('bunny_x_777_05','participants.present_in_scene[1]'):(7,16,'판단 보류'),
            ('bow_wow_paradise_05','participants.present_in_scene[0]'):(1,10,'판단 보류'),
            ('aria_03','participants.present_in_scene[0]'):(1,10,'판단 보류'),
            ('sugar_00','participants.present_in_scene[0]'):(1,10,'판단 보류'),
            ('dazzling_cupid_02','participants.present_in_scene[3]'):(52,61,'판단 보류'),
            ('laplace_03','participants.remote_or_voice_only[0]'):(23,32,'판단 보류')}
        mentions = {'ark_guardian_01':(1,3),'ark_guardian_08':(32,34),'ark_guardian_09':(49,51),'ark_guardian_15':(25,27),'ark_guardian_23':(49,51)}
        mappings = C.defaultdict(set); speaker_count=0; diffs=[]; all_labels=set()
        for sid,s in self.scenes.items():
            for path,field,obj in objects(s):
                if field in {'present_in_scene','remote_or_voice_only'}:
                    speaker_count += 1; all_labels.add(label(obj))
                    if obj['entity_id']:
                        mappings[label(obj)].add(obj['entity_id'])
                        expected=self.registry['speaker_lookup'].get(label(obj),{}).get('entity_id')
                        if expected != obj['entity_id']:diffs.append((sid,path,expected,obj['entity_id']))
                if sid.startswith('ark_guardian_') and obj.get('entity_id')=='char_지휘관':
                    key=f'shard:{sid}#{path}'
                    if sid=='ark_guardian_00':
                        reviewed('Q1',key,'정상','현재 에덴 프레임에서 세실이 언급하는 주인공 지휘관으로, 과거 갓데스 지휘관으로 일괄 바꾸면 안 된다.',(sid,43,45))
                    else:
                        locs=[('ark_guardian_26',24,30)]
                        if sid in mentions:locs.append((sid,*mentions[sid]))
                        reviewed('Q1',key,'오류 의심','과거 갓데스 지휘관은 ark_guardian_26 L26~28에서 엔더슨으로 드러난다. char_지휘관(주인공)으로 연결하면 해당 인물 검색의 장면 집합이 잘못된다.',*locs)
                    self.shard('Q1',sid,path,dict(speaker_label=label(obj),entity_id=obj['entity_id'],context='ARK GUARDIAN'),'이야기 문맥별 정체 검토')
                elif field in {'present_in_scene','remote_or_voice_only'} and label(obj) in labels:
                    if (sid,path) in extra:
                        a,b,v=extra[(sid,path)]
                        locs=[(sid,a,b)]
                        if v=='오류 의심':locs=[('hospital_05',26,35),('cocoa_04',73,82)]
                        reviewed('Q1',f'shard:{sid}#{path}',v,'병원 안내 방송과 컴퓨터 명령 응답이라는 다른 기기가 같은 char_기계음에 묶였다.' if v=='오류 의심' else '다른 이야기의 역할 라벨이나 맥락만으로 동일 인물인지 다른 인물인지 결정할 수 없어 보류한다.',*locs)
                    self.shard('Q1',sid,path,dict(speaker_label=label(obj),entity_id=obj['entity_id'],title_id=self.meta[sid]['title_id']),'여러 타이틀에서 쓰인 일반적인 역할/장치 라벨에 단일 인물 ID가 붙었다. 원문 미확인 대상은 보류한다.')
        self.stats['Q1']={'speaker_items':speaker_count,'distinct_speaker_labels':len(all_labels),'nonnull_id_labels':len(mappings),'multiple_nonnull_id_labels':sum(len(v)>1 for v in mappings.values()),'lookup_differences':len(diffs),'other_label_candidates':sorted(labels)}

    def q4(self):
        def scenes_for(key,character=False):
            bucket=self.index['entities'].get(key,{})
            return {x['scene_id'] for field in PARTS for x in bucket.get(field,[]) if not character or field!='mentioned_only' or x['entity_type']=='character'}
        variants=C.defaultdict(set)
        for c in self.candidates:variants[(c['suggested_type'],norm(c['surface_text']))].add(c['surface_text'])
        groups=C.defaultdict(set)
        for (typ,_),surfaces in variants.items():
            if len(surfaces)>1:groups[tuple(sorted(surfaces))].add(typ)
        grouped={v for g in groups for v in g}
        registered_matches=0;split_count=0;split_pairs=set();split_ids=set();split_surfaces=set()
        top=[];no_surface=0
        for c in self.candidates:
            surface=c['surface_text'];typ=c['suggested_type']
            ids=self.names.get(norm(surface),set()) if typ in {'character','alias'} else set()
            sset=scenes_for('surface:'+surface,True)
            idset=set().union(*(scenes_for(k,True) for k in ids))
            lost=sset-idset if ids else set()
            registered_matches += bool(ids)
            if lost:
                split_count += 1;split_pairs.update((surface,sid) for sid in lost);split_ids.update(ids);split_surfaces.add(surface)
            exists='surface:'+surface in self.index['entities'];no_surface+=not exists
            scenes={o['scene_id'] for o in c['occurrences']}
            obs=dict(surface_text=surface,suggested_type=typ,occurrence_count=c['occurrence_count'],distinct_scene_count=len(scenes),occurrence_scene_ids=sorted(scenes),
                     registered_entity_ids=sorted(ids),surface_key_exists=exists,surface_character_scenes=len(sset),registered_character_scenes=len(idset),surface_only_scene_ids=sorted(lost),normalization_variant=surface in grouped)
            risky=bool(ids or surface in grouped)
            self.finding('Q4',f'file:data/graph/unregistered_entity_candidates.json#{typ}::{surface}',obs,
                         '등록명 또는 공백/대소문자 변형 후보이다. 각 검색 키의 장면 집합 차이는 관찰되지만 미확인 동일성은 보류한다.' if risky else '빈도만으로 누락을 판정하지 않는다. 이번 등록명/표기변형 검사에서는 분산 징후가 없었다(의미적 동일성의 정상 보증 아님).',
                         '판단 보류' if risky else '정상')
            top.append((len(scenes),surface,typ))
        for surfaces,types in sorted(groups.items()):
            sets={surface:scenes_for('surface:'+surface) for surface in surfaces}
            union=set().union(*sets.values())
            self.finding('Q4','group:'+'|'.join(surfaces),dict(surfaces=list(surfaces),suggested_types=sorted(types),scene_counts={k:len(v) for k,v in sets.items()},union_scene_count=len(union),missed_by_single_key={k:len(union-v) for k,v in sets.items()}),'같은 유형 안에서 공백/대소문자 정규화가 같은 표기들이다. 장면 집합은 분산되어 있으나 같은 대상인지 원문 미확인 항목은 보류한다.')
        self.stats['Q4']=dict(candidate_count=len(self.candidates),occurrences=sum(c['occurrence_count'] for c in self.candidates),scene_count=len({o['scene_id'] for c in self.candidates for o in c['occurrences']}),
                              types=dict(C.Counter(c['suggested_type'] for c in self.candidates)),registered_matches=registered_matches,split_candidates=split_count,split_surfaces=len(split_surfaces),split_registered_ids=len(split_ids),split_surface_scene_pairs=len(split_pairs),split_scenes=len({sid for _,sid in split_pairs}),normalization_groups=len(groups),type_normalization_groups=sum(len(v)>1 for v in variants.values()),without_surface_bucket=no_surface,top_frequency=sorted(top,reverse=True)[:15])

    def q2(self):
        by_label=C.defaultdict(lambda:C.defaultdict(list));denominator=0;wrong=[]
        for sid,s in self.scenes.items():
            for path,field,obj in objects(s):
                if field not in PARTS:continue
                denominator+=1;name=label(obj);key=obj.get('entity_id') or 'surface:'+name
                by_label[name][key].append((sid,path,obj.get('entity_type','character')))
                expected=self.raw_names.get(name,set())
                if obj.get('entity_id') and expected and obj['entity_id'] not in expected:wrong.append((sid,path,name,obj['entity_id']))
        samples={
          '아나키오르':('main_34_00',23,27),'식스오':('dirty_backyard_08',125,129),
          '티미':('lion_heart_06',1,5),'헨젤':('old_tales_27',19,23),'그레텔':('old_tales_27',19,23),
          '지휘관':('특이랩쳐보고서-후_00',3,7),'신':('종말의서_00',8,12)}
        split_count=0
        for name,buckets in sorted(by_label.items()):
            if len(buckets)<2:continue
            split_count+=1;key='index:entities['+json.dumps('surface:'+name,ensure_ascii=False)+']'
            obs=dict(surface=name,keys={k:dict(item_count=len(v),scene_count=len({x[0] for x in v}),sample_items=[dict(scene_id=s,field_path=p,entity_type=t) for s,p,t in v[:5]]) for k,v in sorted(buckets.items())},review_scope='표본은 키 집합의 일부 항목만 확인; 전체 동일성을 보증하지 않음')
            if name in samples:
                hold=name in {'지휘관','신'}
                if hold:obs['sample_verdict']='정상'
                reviewed('Q2',key,'판단 보류' if hold else '연결 누락 의심','확인한 null 표본은 다른 정체의 일반 지휘관/신적 존재여서 정상이다. 그룹 전체를 기계적으로 병합하면 안 되며 나머지는 미확인이다.' if hold else '동일 이름의 등록 인물이 표본 장면에서 surface 키로 갈라진 것을 원문으로 확인했다. 그룹의 모든 항목을 확인한 것은 아니다.',samples[name])
            self.finding('Q2',key,obs,'같은 표기가 둘 이상의 실제 검색 키로 분산된다. 동명이의나 일반 역할일 수 있으므로 원문 미확인 그룹은 보류한다.')
        def compact(x):return re.sub(r'[\s\[\].]','',unicodedata.normalize('NFKC',x)).casefold()
        pool=C.defaultdict(set)
        for name in self.raw_names:pool[compact(name)].add(name)
        for key in self.index['entities']:
            if key.startswith('surface:'):pool[compact(key[8:])].add(key[8:])
        groups=[]
        for names in pool.values():
            if len(names)<2:continue
            regids=set().union(*(self.raw_names.get(n,set()) for n in names))
            keys=regids|{'surface:'+n for n in names if 'surface:'+n in self.index['entities']}
            if regids and len(keys)>1:groups.append(set(names))
        expansions={'[블랙로즈]':'메이든','[사이코뮤]':'엑시아','[붐가이]':'일레그'}
        for g in groups:
            for alias,canonical in expansions.items():
                if alias in g:g.add(canonical)
        groups.extend([{'N102','앤'},{'어린 노아','노아'},{'어린 슈엔','슈엔'},{'어린 노라','노라'},{'그레이브','에이브'},{'E.H.','엘리시온 하퍼'},{'[치유의바람]','치유하는바람'}])
        # Curated review decisions retain ambiguity for avatars/inner voices and collectives.
        definitions=[
         (['[블랙로즈]','블랙로즈','메이든'],'연결 누락 의심','게임 핸들/메신저 표기와 오프라인 메이든의 자기소개가 연결된다.',[('maiden_02',24,40),('maiden_03',169,188),('maiden_00',151,164)]),
         (['[점프만이살길]','점프만이살길'],'연결 누락 의심','같은 게임파티와 오프라인 모임의 자기소개 표기 차이이다.',[('maiden_02',24,40),('maiden_03',169,188)]),
         (['[총술사상향좀]','총술사상향좀'],'연결 누락 의심','같은 게임파티와 오프라인 모임의 자기소개 표기 차이이다.',[('maiden_02',24,40),('maiden_03',169,188)]),
         (['[T.Rony]','T.Rony'],'판단 보류','한쪽은 트로니에게 말을 거는 목소리, 다른 쪽은 트로니의 핸들이다. 기호 제거로 현실 인물과 의인화 목소리를 합치지 않는다.',[('booms_day_01',98,111),('d.ark_hero_02',4,10)]),
         (['[치유의바람]','치유하는바람'],'연결 누락 의심','게임파티 구성원의 오프라인 자기소개에서 별명 변형이 드러난다.',[('maiden_02',24,40),('maiden_03',169,188)]),
         (['N102','앤'],'연결 누락 의심','N102에게 앤이라는 이름을 부여하는 장면이 있다.',[('blabla_n102_001',68,98)]),
         (['어린 노아','노아'],'연결 누락 의심','현재 노아의 반응과 어린 자신을 다룬 회상으로 연결된다.',[('noah_04',45,58)]),
         (['어린 슈엔','슈엔'],'판단 보류','어린 모습이 현재 슈엔을 비난하는 환영/내면 장면이다. 동일 ID 정책 검토가 필요하다.',[('project_matis_26',200,220)]),
         (['어린 노라','노라'],'연결 누락 의심','어린 노라의 꿈과 현재 노라 전환에서 동일 인물 연결 근거를 확인했다.',[('terminus_ticket_27',1,9),('terminus_ticket_27',110,133)]),
         (['그레이브','에이브'],'연결 누락 의심','신데렐라가 동일 인물임을 명시한다. 바디/기억 변화에도 단일 키 탐색은 갈라진다.',[('gingerbreadhouse_12',9,26),('gingerbreadhouse_12',76,85)]),
         (['E.H.','엘리시온 하퍼'],'연결 누락 의심','당사자가 이전 이름을 직접 밝힌다.',[('enter_heaven_06',5,23)]),
         (['[사이코뮤]','사이코뮤','엑시아'],'연결 누락 의심','게임 핸들과 엑시아가 연결된다. 다만 사이코뮤 개발이라는 비인물 concept 용례는 합치면 안 된다.',[('d.ark_hero_01',20,28),('ice_dragon_saga_14',103,107),('main_09_13',35,39)]),
         (['레드 후드','레드후드'],'연결 누락 의심','코드네임의 띄어쓰기 변형이 char ID와 surface 키로 갈라진다.',[('main_24_18',175,179),('main_13_10',1,15),('main_13_10',139,143)]),
         (['[붐가이]','붐가이','일레그'],'연결 누락 의심','엑시아가 붐가이라 부르자 일레그가 응답한다.',[('d.ark_hero_01',20,28)]),
         (['정의 괴도단','정의괴도단'],'판단 보류','개인이 아닌 조직/집합 화자이다. 집합과 인물 엔티티의 정책 문제로 단순 동일 인물 판정은 보류한다.',[('arcane_archive_14',105,110)]),
         (['곰...?','곰…?'],'연결 누락 의심','같은 표본 장면에 대한 등록 표기와 원문 말줄임표 차이이다.',[('persona_on_frontline_03',1,20)]),
         (['ᄋᄋ','ㅇㅇ'],'연결 누락 의심','같은 표본 장면의 호환자모와 분해자모 표기가 검색 키로 갈라졌다. 다른 이야기의 동일 익명 핸들까지 같은 인물이라는 뜻은 아니다.',[('rupee_wintershopper_01',30,42)])]
        for names,verdict,reason,locs in definitions:
            reviewed('Q2','group:'+'|'.join(sorted(names)),verdict,reason+' 레지스트리는 별칭 통합을 Pass 2/3에 유보하므로 추출 규칙 위반으로 단정하지 않는다.',*locs)
        for names in sorted({tuple(sorted(g)) for g in groups}):
            ids=set().union(*(self.raw_names.get(n,set()) for n in names));keys=ids|{'surface:'+n for n in names if 'surface:'+n in self.index['entities']}
            counts={k:len({x['scene_id'] for f in PARTS for x in self.index['entities'].get(k,{}).get(f,[])}) for k in sorted(keys)}
            self.finding('Q2','group:'+'|'.join(names),dict(surfaces=list(names),entity_keys=sorted(keys),scene_counts=counts,overlaps_exact_surface_groups=any(len(by_label.get(n,{}))>1 for n in names),review_scope='대표 근거로 표기 사이 연결을 검토; 모든 개별 참조는 미확인'),'기호/공백/유니코드 변형 또는 원문 자기소개·과거 이름·어린 모습으로 제안한 정체 그룹이다.')
        self.stats['Q2']=dict(participant_items=denominator,exact_surface_split_groups=split_count,alias_groups=len(groups),nonnull_registered_name_wrong_id=len(wrong),wrong_id_examples=wrong[:20])

    def q5(self):
        candidates = {}
        denominators = C.Counter()
        def missing(sid,surface,kind,lines,expected):
            key = (sid,surface)
            if key not in candidates: candidates[key] = dict(kinds=[],lines=[],expected_fields=[],nonindexed_paths=[])
            o = candidates[key]; o['kinds'].append(kind)
            o['lines'] = sorted(set(o['lines']) | set(lines))
            o['expected_fields'] = sorted(set(o['expected_fields']) | set(expected))
        particle = r'(?:님(?:께서|께|은|는|이|가|을|를|의|과|과는|도)?|께서|에게서|에게|한테|으로|이랑|처럼|보다|까지|부터|라고|이라|라는|은|는|이|가|을|를|의|와|과|도|만|에|로|야|아|든|랑|요|들)?'
        patterns = {name: re.compile(r'(?<![\w가-힣])'+re.escape(name)+particle+r'(?![\w가-힣])') for name in self.raw_names if len(name)>=2}
        for sid,s in self.scenes.items():
            gt = self.meta[sid]['mechanical_ground_truth']
            speaking = {p['speaker_label'] for k in ['present_in_scene','remote_or_voice_only'] for p in s['participants'][k]}
            unknowns = {x['unknown_id'] for x in s['unknown_speakers']}
            descriptors = {x['speaker_label'] for x in s['descriptor_speakers']}
            for sp in gt['speakers']:
                if sp['speaker_label'] == '???':continue
                denominators['mechanical_speaker_labels'] += 1
                if sp['speaker_label'] not in speaking:
                    missing(sid,sp['speaker_label'],'speaker_missing',[sp['first_line']],['participants.present_in_scene','participants.remote_or_voice_only'])
                if sp.get('is_descriptor_alias'):
                    denominators['descriptor_labels'] += 1
                    if sp['speaker_label'] not in descriptors:missing(sid,sp['speaker_label'],'descriptor_missing',[sp['first_line']],['descriptor_speakers'])
            for u in gt['unknowns']:
                denominators['unknown_lines'] += 1
                if u['unknown_id'] not in unknowns:missing(sid,f"???@L{u['line']:04d}",'unknown_missing',[u['line']],['unknown_speakers'])
            body = '\n'.join(self.source[sid])
            for name,pat in patterns.items():
                if name not in body:continue
                lines = [i for i,line in enumerate(self.source[sid],1) if pat.search(line)]
                if not lines:continue
                denominators['registered_scene_surface_matches'] += 1
                if self.raw_names[name] & self.index_ids[sid] or norm(name) in self.index_text[sid]:continue
                missing(sid,name,'registered_literal_missing',lines,['participants','relationships/clues/other indexed fields'])
            # Also detect non-character targets explicitly listed as candidates but absent from all indexed payloads.
            for cand in s['unregistered_entity_candidates']:
                surface = cand['surface_text']
                if not surface or surface not in body or norm(surface) in self.index_text[sid]:continue
                if self.names.get(norm(surface),set()) & self.index_ids[sid]:continue
                lines = [i for i,line in enumerate(self.source[sid],1) if surface in line]
                missing(sid,surface,'candidate_only',lines,['participants.mentioned_only','other indexed fields'])
        trace_counts = C.Counter(); by_kind = C.Counter(); field_gaps = C.defaultdict(set)
        for (sid,surface),obs in sorted(candidates.items()):
            s = self.scenes[sid]
            for field in UNINDEXED:
                for path,value in strings(s.get(field),field):
                    if norm(surface) and norm(surface) in norm(value):obs['nonindexed_paths'].append(path)
            for path,value in strings(s['participants'].get('document_author'),'participants.document_author'):
                if norm(surface) and norm(surface) in norm(value):obs['nonindexed_paths'].append(path)
            obs['presence'] = 'unindexed_only' if obs['nonindexed_paths'] else 'absent_everywhere'
            obs['source_surface'] = surface
            trace_counts[obs['presence']] += 1; by_kind.update(set(obs['kinds']))
            for path in obs['nonindexed_paths']:field_gaps[path.split('[')[0].split('.')[0] if not path.startswith('participants.document_author') else 'participants.document_author'].add((sid,surface))
            self.finding('Q5',f'missing:{sid}#{surface}',obs,'원문 기계 문자열/화자 대조에서 색인되는 필드에 해당 대상의 흔적을 찾지 못했다. 동명이의·일반어·추출 필요성은 원문 검토 전 보류한다.',sid=sid)
        self.stats['Q5'] = {'denominators':dict(denominators),'presence':dict(trace_counts),'kinds':dict(by_kind),'unindexed_field_target_counts':{k:len(v) for k,v in field_gaps.items()}}

    def run(self):
        self.q1(); self.q2(); self.q3(); self.q4(); self.q5(); self.q6(); self.q7()

    def q6(self):
        # Only pure functions are called. Importing validate-output through the merger
        # does not invoke validateShard; no batch validation or output mutation occurs.
        code = r'''
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const input=process.argv[1], root=path.join(input,'data/graph');
const {enrichSceneFromManifest,buildPass1IndexAndCandidates}=await import(pathToFileURL(path.join(input,'scripts/graph/merge-and-index.mjs')).href);
const read=x=>JSON.parse(fs.readFileSync(path.join(root,x),'utf8'));
const manifest=read('manifest.json'), index=read('pass1_index.json'), progress=read('progress.json');
const scenes=[], stale=[], batches=[], rawCounts={};
for(const file of fs.readdirSync(path.join(root,'pass1/shards')).filter(x=>/^batch_.*\.json$/.test(x)).sort()){
 const shard=read('pass1/shards/'+file), bid=shard.batch_id||file.slice(0,-5); batches.push(bid); rawCounts[bid]=shard.scenes.length;
 for(const s of shard.scenes){const m=manifest.scenes[s.scene_id];if(!m)throw Error('missing manifest '+s.scene_id);if(m.batch_id!==bid){stale.push({scene_id:s.scene_id,batch_id:bid,current_batch_id:m.batch_id});continue;}scenes.push(enrichSceneFromManifest(s,m));}
}
const rebuilt=buildPass1IndexAndCandidates(scenes,{mergedBatchIds:batches});
function compare(a,b){let count=0;const examples=[];function walk(x,y,p){if(JSON.stringify(x)===JSON.stringify(y))return;if(Array.isArray(x)&&Array.isArray(y)){if(x.length!==y.length){count++;if(examples.length<30)examples.push({path:p+'.length',expected:x.length,actual:y.length});}for(let i=0;i<Math.max(x.length,y.length);i++)walk(x[i],y[i],p+'['+i+']');}else if(x&&y&&typeof x==='object'&&typeof y==='object'){for(const k of new Set([...Object.keys(x),...Object.keys(y)])){if(k==='generated_at')continue;walk(x[k],y[k],p+'['+JSON.stringify(k)+']');}}else{count++;if(examples.length<30)examples.push({path:p,expected:x,actual:y});}}walk(a,b,'');return {count,examples};}
const views=fs.readdirSync(path.join(root,'pass1/by_title')).filter(x=>x.endsWith('.json')).flatMap(f=>read('pass1/by_title/'+f).scenes);
const byId=x=>Object.fromEntries(x.map(s=>[s.scene_id,s]));
const progressProblems=[];
for(const s of scenes){const p=progress.scenes[s.scene_id],m=manifest.scenes[s.scene_id];if(!p||p.status!=='merged'||p.batch_id!==m.batch_id||p.source_sha256!==m.source_sha256)progressProblems.push({scene_id:s.scene_id,record:p});}
const mainProgressBatches=Object.values(progress.batches).filter(b=>!b.is_pilot&&b.status==='merged').map(b=>b.batch_id).sort();
const sceneBatchIds=[...new Set(Object.values(manifest.scenes).map(s=>s.batch_id))].sort();
const report={counts:{raw_shard_scenes:Object.values(rawCounts).reduce((a,b)=>a+b,0),live_scenes:scenes.length,stale_scenes:stale.length,shard_batches:batches.length,manifest_scenes:Object.keys(manifest.scenes).length,manifest_current_batch_records:manifest.batches.length,manifest_scene_batch_ids:sceneBatchIds.length,manifest_reused_scenes:manifest.totals.reused_scenes_count,index_scenes:index.merged_scenes_count,index_batches:index.merged_batches_count,view_scenes:views.length,progress_scenes:Object.keys(progress.scenes).length,progress_main_batches:mainProgressBatches.length,progress_pilot_batches:Object.values(progress.batches).filter(b=>b.is_pilot).length},index_compare:compare(rebuilt.pass1IndexDoc,index),by_title_compare:compare(byId(scenes),byId(views)),candidates_compare:compare(rebuilt.unregisteredCandidatesDoc,read('unregistered_entity_candidates.json')),progress_problems:progressProblems,batch_comparisons:{index_vs_shards:compare([...index.merged_batch_ids].sort(),[...batches].sort()),progress_vs_shards:compare(mainProgressBatches,[...batches].sort()),manifest_scenes_vs_shards:compare(sceneBatchIds,[...batches].sort())},stale};
console.log(JSON.stringify(report));
'''
        result=subprocess.run(['node','--input-type=module','-e',code,str(self.root)],capture_output=True,text=True,check=True)
        audit=json.loads(result.stdout)
        problems=sum(audit[k]['count'] for k in ['index_compare','by_title_compare','candidates_compare'])+len(audit['progress_problems'])+sum(v['count'] for v in audit['batch_comparisons'].values())
        self.finding('Q6','global:merge_consistency',audit,'현재 배치 샤드를 순수 병합 함수로 재구성하여 전체 인덱스, 타이틀 뷰, 후보 집계와 비교했다. generated_at만 제외했다. stale 레코드는 제외했고 progress의 상태·배치·본문 해시도 비교했다.','정상' if problems==0 else '오류 의심')
        blind={}
        for field in UNINDEXED+['participants.document_author']:
            values=[s['participants'].get('document_author') if field=='participants.document_author' else s.get(field) for s in self.scenes.values()]
            obs=dict(nonempty_scene_count=sum(bool(v) for v in values),item_count=sum(len(v) if isinstance(v,list) else int(bool(v)) for v in values),
                     q5_source_literal_target_scene_pairs=self.stats['Q5']['unindexed_field_target_counts'].get(field,0),
                     q5_reviewed_missing_pairs=sum(f['question']=='Q5' and f['verdict']=='연결 누락 의심' and any(p==field or p.startswith(field+'[') or p.startswith(field+'.') for p in f['observed'].get('nonindexed_paths',[])) for f in self.findings),
                     measurement='전체 필드 항목 수와 원문 문자열로 확인된 비색인 전용 (장면,표기)쌍. 전자는 의미적으로 독점인 정보의 수가 아니며 후자는 오탐을 포함한 후보 수이다.')
            if field=='participants.document_author':
                obs['registered_id_objects']=sum(bool(v and v.get('entity_id')) for v in values)
                obs['author_name_absent_from_indexed_payload']=sum(bool(s['participants']['document_author'] and s['participants']['document_author'].get('name') and norm(s['participants']['document_author']['name']) not in self.index_text[sid]) for sid,s in self.scenes.items())
            self.finding('Q6','global:unindexed_field:'+field,obs,'병합기가 이 필드를 역색인에 복사하지 않는다. 구조적 사각지대이며 추출 데이터 오류 판정은 아니다. 다른 필드의 중복 의미와 Pass 2 원문 역스캔의 보완 가능성은 별도다.','판단 보류')
            blind[field]=obs
        self.stats['Q6']={'audit':{k:v for k,v in audit.items() if k!='stale'},'blind_fields':blind}

    def q7(self):
        affected=set();entry_count=0;mixed=0
        for key,bucket in self.index['entities'].items():
            types=C.Counter();bad=[]
            for field in PARTS:
                for x in bucket[field]:
                    typ=x['entity_type'] if field=='mentioned_only' else 'character';types[typ]+=1
                    if typ!=bucket['entity_type']:bad.append(x)
            if len(types)<2:continue
            mixed+=1;entry_count+=len(bad);affected.update(x['scene_id'] for x in bad)
            self.finding('Q7','index:entities['+json.dumps(key,ensure_ascii=False)+']',dict(bucket_entity_type=bucket['entity_type'],actual_entry_types=dict(types),mismatched_entries=len(bad),affected_scene_ids=sorted({x['scene_id'] for x in bad})),
                         '버킷 유형은 첫 항목으로 고정되지만 여러 대상 유형이 같은 키에 있다. Pass 2가 버킷 유형으로 필터하면 일부 항목이 배제될 조건부 위험이다. 인물 동일성 오류와 구별하며 실제 필터 사용은 실행하지 않아 보류한다.')
        self.stats['Q7']=dict(entity_buckets=len(self.index['entities']),mixed_type_buckets=mixed,mismatched_entries=entry_count,affected_scenes=len(affected))

    def output(self, complete=False):
        self.findings.sort(key=lambda x:(x['question'],x['target_key']))
        keys = [(f['question'],f['target_key']) for f in self.findings]
        assert len(keys) == len(set(keys)), 'Duplicate finding key'
        reviewed = C.Counter(f['question'] for f in self.findings if f['source_checked'])
        assert all(n<=30 for n in reviewed.values()), reviewed
        assert set(REVIEW).issubset(set(keys)), 'A reviewed finding was dropped'
        for f in self.findings:
            assert f['verdict'] in {'정상','판단 보류','오류 의심','연결 누락 의심'}
            if f['target_key'].startswith('shard:'):
                assert f['target_key']==f"shard:{f['scene_id']}#{f['field_path']}"
                assert isinstance(at(self.scenes[f['scene_id']],f['field_path']),dict)
                assert not f['field_path'].endswith('.entity_id')
            if f['target_key'].startswith('group:'):
                surfaces=f['observed']['surfaces']
                assert f['target_key']=='group:'+'|'.join(sorted(surfaces))
            for c in f['source_checked']:
                assert 1<=c['line_start']<=c['line_end']<=len(self.source[c['scene_id']])
        (OUTPUT/'findings.jsonl').write_text(''.join(json.dumps(f,ensure_ascii=False)+'\n' for f in self.findings))
        counts = {q:dict(C.Counter(f['verdict'] for f in self.findings if f['question']==q)) for q in [f'Q{i}' for i in range(1,8)]}
        text = self.report(counts,reviewed)
        if complete:text += '\n진단 완료: '+datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M:%S KST')+'\n'
        (OUTPUT/'report.md').write_text(text)
        print(json.dumps({'findings':len(self.findings),'counts':counts,'reviewed':dict(reviewed)},ensure_ascii=False,indent=2))

    def report(self,counts,reviewed):
        def table(headers,rows):
            def cell(x):return str(x).replace('|','\\|').replace('\n',' ')
            return '\n'+'| '+' | '.join(headers)+' |\n|'+'|'.join(['---']*len(headers))+'|\n'+''.join('| '+' | '.join(cell(x) for x in row)+' |\n' for row in rows)+'\n'
        def tally(q):
            return ' / '.join(f'{v} {counts[q].get(v,0):,}건' for v in ['오류 의심','연결 누락 의심','정상','판단 보류'])
        def examples(q,keys):
            fs={f['target_key']:f for f in self.findings if f['question']==q}
            rows=[]
            for key in keys:
                if key in fs:
                    f=fs[key];rows.append([f"`{key}`",f['verdict'],f['reason']])
            return table(['대상 키','판정','근거/의미'],rows)
        all_sources={c['scene_id'] for f in self.findings for c in f['source_checked']}
        rows=[]
        for q in [f'Q{i}' for i in range(1,8)]:
            qq=[f for f in self.findings if f['question']==q]
            rows.append([q,len(qq),counts[q].get('오류 의심',0),counts[q].get('연결 누락 의심',0),counts[q].get('정상',0),counts[q].get('판단 보류',0),reviewed.get(q,0)])
        out=f'''# GPT Pass 1 독립 진단

## 1. 고정 입력, 생성 명령과 실행

- 기준 커밋: `{COMMIT}` (`0dee599`).
- 입력 폴더: `{self.root}` — 저장소 밖 임시 폴더.
- 입력 생성·해시 확인 시각: **{CREATED_AT}**.
- 매니페스트 SHA-256: `{MANIFEST_HASH}` — 질문지 지정값과 일치.
- 매니페스트 `generated_at`: `{self.manifest['generated_at']}`.
- 질문지 전체를 먼저 읽었다. 작업 폴더에서는 질문지와 복사할 매니페스트만 입력으로 사용했다. 나머지는 고정 입력에서 읽었다. 상대 진단 폴더, 기존 보고서, pilot 샤드, 백업, repairs는 읽지 않았다.

실제 실행한 입력 생성 명령은 다음과 같다. `mktemp`가 위 경로를 반환했다.

```sh
input_dir=$(mktemp -d /tmp/nikke-pass1-gpt.XXXXXX)
mkdir -p "$input_dir/data/graph"
git archive 0dee599 -- data/graph/pass1/shards data/graph/pass1/by_title data/graph/pass1_index.json data/graph/progress.json data/graph/entity_registry.json data/graph/generic_roles.json data/graph/descriptor_review.json data/graph/unregistered_entity_candidates.json public/scripts data/newScripts.ts scripts/graph GRAPH_RAG_SPEC.md GRAPH_RAG_PASS1_RULES.md | tar -x -C "$input_dir"
cp data/graph/manifest.json "$input_dir/data/graph/manifest.json"
sha256sum "$input_dir/data/graph/manifest.json"
TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S %Z'
```

재현 명령(저장소 루트 기준):

```sh
python3 data/graph/reports/diag/gpt/diagnose.py {self.root} --complete
```

Python 3.9 이상과 Node.js가 필요하다. 외부 Python 패키지는 쓰지 않는다. 다른 진단자는 같은 방식으로 만든 자기 입력 폴더를 인자로 전달하면 된다. 출력은 실행한 `diagnose.py`와 같은 폴더의 `findings.jsonl`, `report.md` 두 파일이다. 이 스크립트를 다른 폴더로 복사해 실행하면 그 폴더에 쓴다. `--complete`를 빼면 완료 표시 없이 중간 보고서를 쓴다. 원문 판정은 스크립트의 명시적 `REVIEW`/검토 목록으로 고정했으며 다시 실행할 때 모델에게 재판정을 요청하지 않는다. 재실행 완료 시각 외 결과는 결정적이다.

샤드 파일은 `batch_*.json`만 읽었다. 439배치의 5,596 레코드 중 매니페스트 `scene.batch_id`와 불일치하는 36개를 제외하여 **5,560장면**을 분석했다. Q6에서만 제외 레코드의 오염 여부를 검사했다. `item_id`는 `by_title`에서 가져왔다. 내부 정체 공개 객체에 자체 ID가 없으면 null로 유지했다. 원문은 매니페스트 `source_file`로 찾고 SCRIPT_ID 단위로 파싱했으며 **5,560개 본문 해시가 모두 매니페스트와 일치**했다.

`data/newScripts.ts`는 10개 카테고리 모듈을 합치는 진입점임을 확인했다. 질문지의 고정 추출 목록에 그 하위 모듈은 없으므로 등록 목록을 다시 컴파일하거나 재구축하지 않았다. 진단 모집단은 해시가 고정된 매니페스트의 장면 집합이다. `loadNewScriptsData`, 매니페스트 생성기, 전체 배치 검증기, Pass 2, 보수는 실행하지 않았다. Q6은 병합기의 순수 함수만 호출하여 메모리에서 비교했다.

## 2. 질문별 결과

다음은 JSONL **판정 줄 수**다. 질문 간 같은 장면·대상의 중복이 있으므로 합계를 고유 오류 수로 읽으면 안 된다. 특히 Q2/Q4의 그룹은 개별 인물이나 모든 장면에 대한 판정이 아니다. Q3의 정상 null은 JSONL에서 생략하고 아래 분모 표에 모두 집계했다. Q4 정상은 “이번 표기 분산 검사에서 징후 없음”이라는 제한된 뜻이다. 설계 사각지대와 조건부 위험은 `판단 보류`로 적어 데이터 오류와 구분했다.
'''
        out+=table(['질문','JSONL 줄','오류 의심','연결 누락 의심','정상','판단 보류','원문 확인 줄'],rows)
        q1=self.stats['Q1']
        out+=f'''### Q1. 이야기 맥락에 따른 화자 정체

**기준·분모:** 발화 참여 항목 {q1['speaker_items']:,}개, 라벨 {q1['distinct_speaker_labels']:,}종을 먼저 레지스트리와 대조했다. non-null ID 라벨 {q1['nonnull_id_labels']}종에서 같은 라벨이 여러 non-null ID로 연결된 경우와 레지스트리 제안 ID와의 차이는 모두 0이었다. 따라서 기계적으로 제안 ID를 지켰다는 사실은 문맥상 정체의 정당성을 보장하지 않는다. ARK의 `char_지휘관` 22항목과 여러 타이틀에 쓰이는 역할/장치 라벨 5종(기계음·아주머니·마스터·진행자·자산가) 40항목을 별도로 검토 대상으로 삼았다.

**건수:** {tally('Q1')}. ARK는 현재 프레임 1항목 정상, 과거 지휘관 21항목 오류 의심이다. 후자는 발화 16장면과 언급 5장면이다. 발화 장면 접미사는 03, 04, 07, 10, 11, 12, 13, 16, 17, 18, 20, 21, 22, 24, 25, 26이다. **질문지의 알려진 15건과 고정 입력에서 센 16건은 1건 차이가 있다.** 입력의 현재 발화 참여 항목으로 센 결과를 유지하며 질문지나 데이터를 수정하지 않았다. 다른 라벨에서는 병원 방송/PC 명령인 기계음 2항목 오류 의심, 38항목 보류다.

**표본 선택:** 알려진 사례를 빠짐없이 포함하되 현재 프레임의 반례도 검토했다. 추가 라벨은 서로 다른 이야기의 역할/장치 용례 대표를 골랐다. 30줄에 원문 근거가 있고 미확인 32줄은 전부 보류다. 다른 장면에 `ark_guardian_26` 근거를 적용한 경우에도 그 findings 줄마다 원문 확인 1건으로 셌다.
'''
        out+=examples('Q1',['shard:ark_guardian_00#participants.mentioned_only[11]','shard:hospital_05#participants.present_in_scene[4]','shard:cocoa_04#participants.present_in_scene[4]'])
        out+='**한계:** 일반 역할 후보 5종은 전수 의미 검수 결과가 아니다. 같은 이름을 쓰는 모든 별도 인물, 신체·시대·환영의 정체 경계를 자동으로 포괄하지 못한다.\n\n'
        q2=self.stats['Q2']
        out+=f'''### Q2. 표기/연결로 인한 정체 분열·결합

**기준·분모:** 참여자 네 배열 {q2['participant_items']:,}항목에서 실제 검색 키(`entity_id` 또는 `surface:표기`)를 비교했다. 동일 표기에 키가 둘 이상인 {q2['exact_surface_split_groups']}그룹을 찾았다. 등록 이름·표면 키를 NFKC, 공백·대괄호·마침표 제거, casefold로 묶은 10그룹에, 원문에서 이름 부여/과거 이름/어린 모습/별명 변형이 확인되거나 의심되는 7그룹을 더했다. 핸들 3그룹은 실명까지 확장했다. 정확 등록 이름이 다른 non-null 등록 ID에 연결된 충돌은 {q2['nonnull_registered_name_wrong_id']}건이다.

**건수:** {tally('Q2')}. 동일 표기 134 + 별칭/표기 그룹 {q2['alias_groups']} = {sum(counts['Q2'].values())}줄이다. 24줄을 원문 검토했으며 나머지 127줄은 보류다. 같은 대상이 `index:`와 `group:` 양쪽에 포함될 수 있다. 그룹 장면 수는 키별 검색 노출 규모이지 잘못된 장면 수가 아니다.

**표본 선택:** 등록/표면 키 분열 대표 7그룹과 기호·유니코드·핸들·이전 이름·어린 모습·별명 대표 17그룹을 골랐다. `지휘관`과 `신`의 null 표본은 각각 정체 불명 일반 지휘관과 신적 존재로 정상 용례였지만, 전체 그룹은 미확인 항목을 포함해 보류했다. 별칭 통합을 Pass 2/3에 유보한 레지스트리 설계 때문에 분열 위험을 추출 규칙 위반으로 단정하지 않는다.
'''
        out+=examples('Q2',['group:N102|앤','group:T.Rony|[T.Rony]','group:[블랙로즈]|메이든|블랙로즈','group:그레이브|에이브','index:entities["surface:신"]'])
        out+='**한계:** 완전히 다른 별명, 번역, 분신, 환영의 정체는 문자열 정규화로 완전 탐지할 수 없다. 직접 확인한 대표 근거를 같은 키의 모든 용례에 확장하지 않았다.\n\n'
        q3=self.stats['Q3']['fields'];fields=PARTS+['document_author','unknown_speakers.resolved_in_same_scene_to','descriptor_speakers.resolved_in_same_scene_to']
        total=sum(q3[k]['denominator'] for k in fields);nulls=sum(q3[k]['null'] for k in fields);normal=sum(q3[k].get('정상',0) for k in fields);registered=sum(q3[k].get('registered_name',0) for k in fields)
        out+=f'''### Q3. entity_id null

**기준:** 비인물 `mentioned_only`는 정상 null이다. 고정 `generic_roles`의 미상/역할/묘사형 라벨과 정규화 일치하면 정상으로 센다. 등록 이름에 NFKC·공백 제거·casefold가 일치하지만 ID가 null이면 연결 누락 후보로 삼는다. 이름이 없거나 작성자·기록자·목소리 등 정체 없는 작성 주체 표현인 `document_author`도 정상 null로 센다. 나머지는 미등록 고유명/별칭/일반 지칭을 원문 없이 구분하지 못하므로 보류한다. 정상 분류는 이 기계 기준의 판단이며 실제 인물 정체가 밝혀지지 않았다는 보증은 아니다.

**분모:** 배열은 항목 수, `document_author`는 객체가 null이 아닌 장면 수, 두 `resolved_in_same_scene_to`는 객체가 null이 아닌 항목 수다. 아래 인물/비인물 하위 행은 `mentioned_only`의 부분집합이다.
'''
        order=PARTS+['mentioned_only.character','mentioned_only.noncharacter','document_author','unknown_speakers.resolved_in_same_scene_to','descriptor_speakers.resolved_in_same_scene_to']
        out+=table(['필드','분모','non-null','null','정상 null','연결 누락 의심','보류 null'],[[k,q3[k]['denominator'],q3[k].get('nonnull',0),q3[k]['null'],q3[k].get('정상',0),q3[k].get('연결 누락 의심',0),q3[k].get('판단 보류',0)] for k in order])
        out+=f'''중복 하위 행을 빼면 전체 **{total:,}항목 / null {nulls:,}항목**이다. 정상 null **{normal:,}개**는 JSONL에서 생략했다. 등록 이름과 정규화 일치한 null은 **{registered}개**다. 그중 30개를 직접 읽어 27개 연결 누락 의심, 3개 보류로 남겼다. 전체 JSONL 비정상/미해결 null은 {tally('Q3')}. 원문을 보지 않은 {sum(counts['Q3'].values())-reviewed.get('Q3',0):,}개는 모두 보류다.

`mentioned_only` 비인물 중 non-null 1개는 `phantom_thief_vs_detective_14`의 squad `정의 괴도단 → char_정의_괴도단`이다. null 분모에서 숨기지 않았으며 Q2 집합 화자 그룹·Q7 유형 문제와 연결해 해석한다.

**표본 선택:** 등록명 일치 후보에서 mentioned보다 현장/원격 필드를 먼저 보고, (필드, 표기)가 겹치지 않도록 표기·장면 유니코드순으로 30개를 골랐다. 상위 빈도 추정용 무작위 표본이 아니다.
'''
        out+=examples('Q3',['shard:main_24_21#participants.present_silent[0]','shard:main_30_09#participants.present_silent[0]','shard:rupee_wintershopper_01#participants.remote_or_voice_only[3]'])
        out+='**한계:** 정상 역할 사전의 오분류와 작성자 표현 휴리스틱의 오류는 별도 정체 검토가 필요하다. 등록명에 없는 별칭은 보류에 많이 남으며, 이 수를 연결 누락 수로 해석하면 안 된다.\n\n'
        q4=self.stats['Q4']
        out+=f'''### Q4. 미등록 후보 빈도와 실제 검색 분산

**기준·분모:** 파일의 {q4['candidate_count']:,}개 `(suggested_type, surface_text)` 항목과 장면 후보 {q4['occurrences']:,}회, 후보 등장 {q4['scene_count']:,}장면이다. 모든 file 판정에 발생 횟수와 고유 장면 수를 보존했다. 빈도만 높다는 이유로 오류로 보지 않는다. character/alias 후보를 등록 이름에 정규화 일치시키고 `surface` 장면 집합에서 등록 ID 장면 집합을 뺀다. 이때 mentioned의 비인물 용례는 제외한다. 같은 유형 안에서 공백/대소문자 변형을 찾고, 같은 표기 집합이 여러 유형에서 나오면 `group:` 한 줄로 합쳤다.

**건수:** {tally('Q4')}. 4,531 file 판정과 91 group 판정이다. 등록명 일치 후보 {q4['registered_matches']}개 중 실제 검색 집합이 갈라진 후보 **{q4['split_candidates']}개 / {q4['split_surfaces']}표기 / {q4['split_registered_ids']}등록 ID**다. 등록 ID 한 키로 빠지는 것은 **{q4['split_surface_scene_pairs']} (표기,장면)쌍 / {q4['split_scenes']}고유 장면**이며, 동명이의 여부가 미확인인 기계 후보 규모다. 비인물까지 합친 326쌍/257장면은 인물 누락 수로 사용하지 않는다.

유형별 표기 변형 {q4['type_normalization_groups']}그룹을 표기 집합으로 중복 제거하면 {q4['normalization_groups']}그룹이다. 90그룹은 두 키 이상이 실제 존재하고, `복숭아 꽃님|복숭아꽃님`은 한 키가 없다. 정확 surface 버킷이 없는 후보 {q4['without_surface_bucket']}개도 있으나 다른 ID/관계/단서에 흔적이 있을 수 있어 바로 누락으로 판정하지 않는다. 후보 자체는 index에 직접 들어가지 않고 참여자 네 필드에 있어야 surface 엔티티 키가 생긴다.

**표본 선택:** 등록명 일치 중 빈도 높은 대표 6항목과 장소/조직의 공백 변형 4그룹을 확인했다. 직접 검토 10줄 중 9줄 연결 누락 의심, 지휘관실 그룹 1줄 보류다. 보류 중 419줄은 원문 미확인이다. 나머지 정상 4,193줄은 해당 검사에서 징후가 없다는 의미로서 모든 별칭이 일치한다는 보증이 아니다.
'''
        out+=table(['후보 표기','종류','등장 장면 수'],[[surface,typ,n] for n,surface,typ in q4['top_frequency'][:10]])
        out+=examples('Q4',['file:data/graph/unregistered_entity_candidates.json#character::아나키오르','group:중앙 정부|중앙정부','group:지휘관 실|지휘관실'])
        out+='**한계:** 의미상 별칭이나 한국어/영어 변환, 같은 장소명으로 불리는 서로 다른 실제 장소는 정규화로 판정할 수 없다. Q2와 중복되는 등록/표면 분열을 별개 오류로 더하지 않는다.\n\n'
        q5=self.stats['Q5']
        out+='''### Q5. 원문 대상의 색인 필드 흔적 누락

**색인 범위:** 병합기에서 참여자 `present_in_scene`, `present_silent`, `remote_or_voice_only`, `mentioned_only`가 `entities`로 들어간다. `unknown_speakers`, `descriptor_speakers`(정체 공개 객체 포함), `relationship_and_lore_notes`, `forms_of_address`, `clues_and_hooks`도 각각 색인된다. `document_author`, `summary`, `events_and_claims`, `choice_branches`, 화자 그룹/교차 장면 힌트, 후보 배열 자체는 들어가지 않는다. 참여자 quote는 present_in_scene에는 없고 다른 세 갈래에는 복사된다. 후보 집계 파일은 index와 별도다.

**기준:** 기계 화자 라벨이 현장/원격 배열에 있는지, 모든 `???` 줄 ID와 추적 대상 묘사형 라벨이 전용 배열에 있는지 확인했다. 등록 이름 2자 이상에 단어 경계·조사/호칭 접미사를 허용한 문자열 검사를 원문에 적용했다. 같은 ID가 참여자에 있거나 해당 표기가 색인된 내용 문자열 어디에라도 있으면 누락 후보에서 제외했다. 장면의 미등록 후보 표기가 실제 원문에 있으나 모든 색인 내용에서 없으면 비인물까지 보충했다. 원문 대사는 모델에 전부 표시하지 않고 스크립트가 문자열로 비교했다.

색인되는 quote/detail 등 안의 흔적도 “있음”으로 인정한다. 따라서 엔티티 **키**만 없는 경우와 모든 색인 **내용**에서 없는 경우를 구분한다. 이름 표기와 ID로 놓친 다른 별칭이 실제로 같은 대상이면 표본 검토에서 정상/보류로 낮춘다. `nonindexed_paths`에는 사건 quote, 요약 등 남아 있던 정확 경로를 기록했다. 해당 장면의 여러 줄은 하나의 `missing:` 키에 모았다.
'''
        out+=table(['대조 분모','건수'],list(q5['denominators'].items()))
        out+=f'''**건수:** 기계 화자 누락 0, `???` 누락 0, 추적 묘사형 누락 0이었다. 문자열 후보는 **{sum(q5['presence'].values())} (장면,원문 표기)쌍**으로, 결과 어디에도 표기가 없는 {q5['presence'].get('absent_everywhere',0)}쌍과 비색인 필드에만 있는 {q5['presence'].get('unindexed_only',0)}쌍이다. 이 수는 오탐을 포함한 탐지 후보 수다. 등록명 대조 {q5['kinds'].get('registered_literal_missing',0)}와 후보 배열 보충 {q5['kinds'].get('candidate_only',0)}은 2쌍 겹친다. 최종 판정은 {tally('Q5')}.
'''
        out+=table(['표기 흔적 위치','연결 누락 의심','정상','판단 보류'],[[p,*[sum(f['question']=='Q5' and f['observed'].get('presence')==p and f['verdict']==v for f in self.findings) for v in ['연결 누락 의심','정상','판단 보류']]] for p in ['absent_everywhere','unindexed_only']])
        out+=f'''**표본 선택:** 완전 부재 후보를 먼저, 후보 배열에만 남은 대상을 다음으로, 그 뒤 등록 표기를 유니코드순으로 골랐으며 같은 표기는 한 번만 골라 30줄을 확인했다. 그중 연결 누락 의심 3, 정상 15, 보류 12였다. 원문 미확인 {sum(counts['Q5'].values())-reviewed.get('Q5',0)}줄은 모두 보류했다. 검토의 거짓 양성에는 동사 나가요, 색상 그레이, 음향 노이즈, 노래 라라 등이 있다. 표본을 모집단 누락률 추정에 쓰지 않았다.
'''
        out+=examples('Q5',['missing:clay_more_10#루비','missing:juvenile_days_05#기숙사','missing:main_44_09#엔더슨의 사무실','missing:golden_coin_rush_04#나가'])
        out+='**한계:** 1글자 등록명, 등록/후보 목록에도 없는 일반 대상, 끊긴 이름·오타·번역·모든 한국어 어미는 빠질 수 있다. title/메신저 제목 일치와 동음이의어도 오탐을 만든다. 등록 ID 또는 이름이 quote에 있다는 사실은 관련 사실이 충분히 추출됐다는 뜻이 아니다. 주어진 문자열 기반 방법으로 못 찾는 의미 누락은 남는다.\n\n'
        q6=self.stats['Q6'];audit=q6['audit']
        out+=f'''### Q6. 역색인 반영과 설계 사각지대

**반영 판정 기준·분모:** 현재 샤드 5,560장면에 고정 매니페스트를 적용하여 `enrichSceneFromManifest`와 `buildPass1IndexAndCandidates`를 순수 호출했다. 인덱스의 모든 값·배열 순서·중복, by_title의 전체 장면 객체, 후보 집계 전체를 비교했다. 생성 시각만 제외했다. progress의 장면별 merged 상태·배치·본문 해시와 배치 집합도 비교했다.

**반영 결과:** index 차이 {audit['index_compare']['count']}, by_title 차이 {audit['by_title_compare']['count']}, 후보 집계 차이 {audit['candidates_compare']['count']}, progress 문제 {len(audit['progress_problems'])}건이다. 배치 집합 비교도 모두 0차이이며 stale 36개가 섞인 흔적이 없다. 매니페스트 `batches` 22개는 이번 증분 생성 목록이고 `scenes[].batch_id` 고유값은 439개다. 재사용 장면 5,009개를 포함하므로 22와 439의 차이를 반영 오류로 보지 않는다. progress의 파일럿 메타 3개는 본 실행 439개와 구분했고 파일럿 샤드는 읽지 않았다.

**설계 판정 기준:** 비색인 필드의 전체 항목 수와, Q5에서 원문에 존재하지만 어떤 색인 내용에도 없다고 기계 검출한 (장면,표기)쌍을 구분했다. 필드별 문자 흔적 후보는 서로 중복될 수 있다. 아래 ‘표기 후보’는 오탐을 포함하고 ‘검토 후 의심’만 직접 원문 검토를 거친 수다. 필드 전체 수를 모두 독점적으로 잃어버린 의미 정보 수라고 주장하지 않는다. 표기 후보 0은 이 제한된 검색식에서 탐지되지 않았다는 뜻이며 독점 정보가 없다는 뜻이 아니다. 세밀한 의미 중복 제거는 이번 진단 범위 밖이다.
'''
        out+=table(['비색인 필드','장면','항목/값','그 필드에 남은 비색인 전용 표기 후보','검토 후 의심'],[[k,v['nonempty_scene_count'],v['item_count'],v['q5_source_literal_target_scene_pairs'],v['q5_reviewed_missing_pairs']] for k,v in q6['blind_fields'].items()])
        out+=f'''`events_and_claims` 120,755항목과 `cross_scene_hints` 706항목, 같은 장면 화자 그룹 194항목 등은 구조 자체가 index에 실리지 않는다. 관계/단서/미상화자 단독 항목에 같은 사실이 있더라도 그룹과 교차 장면 힌트의 직접 조회 경로는 없다. 원문 근거가 있는 비색인 전용 문자열 후보는 Q5에서 중복 제거한 {q5['presence'].get('unindexed_only',0)}쌍이다. 작성자 객체는 664개(등록 ID 239개)이고, 이름이 색인 내용 문자열에서 전혀 발견되지 않은 객체는 {q6['blind_fields']['participants.document_author']['author_name_absent_from_indexed_payload']}개다. 마지막 수는 메타데이터를 제외한 내용 필드의 정규화 문자열 기준이며 고유 인물 수가 아니다. 후보 배열은 별도의 후보 집계 파일에도 제공된다.

**건수·대표:** {tally('Q6')}. `global:merge_consistency` 정상 1줄과 `global:unindexed_field:...` 설계 보류 9줄이다. 대표 설계 사례는 Q5의 루비·기숙사·엔더슨의 사무실이다. Q6에서 원문을 추가로 읽지는 않았다.

**한계:** 같은 병합 코드를 실행해 일치를 확인했으므로 병합기 자체의 설계 버그를 독립 구현으로 증명한 것은 아니다. 이를 보완하려고 코드의 색인 필드를 따로 열거하고 비색인 정보를 집계했다. 명세의 Pass 2는 역방향 원문 스캔도 규정하므로 이 사각지대가 실제 Pass 2 전체의 누락으로 반드시 이어진다고 단정하지 않는다.

### Q7. 버킷 유형으로 인한 조건부 누락

**기준·분모:** 인물 정체 분열과 별도로 엔티티 버킷의 최초 `entity_type`과 참여 항목의 실제 유형을 비교했다. 현장/무발화/원격은 character, mentioned는 개별 entity_type을 사용한다. 5,153버킷 중 여러 유형이 섞인 **261개**, 버킷 유형과 맞지 않는 **1,324항목 / 1,080장면**이다.

**건수:** {tally('Q7')}. 전부 원문 미확인 조건부 설계 위험이다. `surface:경찰서`의 버킷은 organization이지만 location 항목 38개가 있다. `surface:아크레인저`는 item 버킷에 squad·character·organization·concept가 함께 있다. Pass 2가 버킷 유형만 보고 필터한다면 해당 항목이 후보에서 빠질 수 있다.

**한계:** Pass 2가 실제로 이 필터를 쓰는지는 실행하지 않았다. 동명 비인물 대상과 다형적 용어가 섞인 이유가 정당할 수 있다. 따라서 버킷을 기계적으로 나누거나 유형을 일괄 바꾸라는 판정은 아니다.

## 3. 원문 확인량과 재현 검증

원문을 모델이 직접 읽어 판정 근거로 사용한 고유 장면은 **{len(all_sources)}개**다. 같은 장면을 여러 질문에서 썼을 때 아래 질문별 수에는 각각 들어가며 전체에서는 한 번만 센다. 원문 문자열 기계 비교 5,560장면은 이 수에 포함하지 않는다.
'''
        out+=table(['질문','source_checked가 있는 findings 줄','원문 고유 장면','미확인 보류 줄'],[[q,reviewed.get(q,0),len({c['scene_id'] for f in self.findings if f['question']==q for c in f['source_checked']}),sum(f['question']==q and f['verdict']=='판단 보류' and not f['source_checked'] for f in self.findings)] for q in counts])
        out+='''각 질문은 원문 확인 30줄 이하이다. 여러 장면을 한 판정의 근거로 쓴 경우에는 모든 범위를 `source_checked`에 기재했다. 원문 표본 밖 의심 후보는 보류했다. Q6/Q7의 기계적 구조 집계는 원문 의미 판단을 하지 않았다.

스크립트는 실행마다 매니페스트 해시, 현재 장면 5,560개와 중복 없음, 본문 해시, 판정 키 중복 없음, 그룹 유니코드 정렬, 샤드 객체 경로, 원문 범위 경계, 원문 검토 상한, 고정 검토 판정의 결과 포함 여부를 검사한다. target_key는 질문지의 shard/missing/file/group/index/global 규칙을 따른다. 정상 항목의 생략 정책을 제외하고 판단 수는 JSONL에서 직접 집계했다.

## 4. 측정 게이트·보수 제안

1. 원문에서 정답 근거 장면을 독립적으로 정한 뒤, 단일 엔티티 ID/단일 표기 검색과 별칭 합집합 검색의 장면 재현율을 각각 측정한다. 이번 findings를 정답 목록 자체로 쓰지는 않는다.
2. ARK 지휘관과 현재 프레임, 일반 지휘관/신, 환영/게임 핸들, 비인물 동명 용례를 함께 넣어 오결합과 누락을 동시에 측정한다. ID 일괄 치환은 피하고 표본 근거를 보수 시 다시 확인한다.
3. 등록명 null과 공백·기호·유니코드 분산 후보부터 검토하되, 그룹 전체에 대표 한 건의 판정을 자동 확장하지 않는다. null은 원칙적으로 검색 불가가 아니라 surface 검색으로 갈라지는 문제다.
4. 문서 작성자·사건·교차 장면 힌트처럼 비색인 필드에 남은 정보를 검색 경로에 보충할지, Pass 2 원문 역스캔으로 회수할지 비교 측정한다. 후보 집계만 보고 장면이 index에 있다고 가정하지 않는다.
5. 보수 전후 같은 정답 목록으로 재측정하고, 후보 장면 재현율과 잘못 들어온 후보 비율을 함께 본다. 혼합 유형 버킷 필터의 영향도 별도 시나리오로 측정한다. 실제 보수와 Pass 2 진행 결정은 이번 진단에서 수행하지 않았다.

'''
        return out

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input_folder',type=pathlib.Path)
    ap.add_argument('--complete',action='store_true')
    args=ap.parse_args()
    d=Diagnosis(args.input_folder);d.run();d.output(args.complete)

if __name__ == '__main__': main()
