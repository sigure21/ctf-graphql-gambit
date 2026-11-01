# GraphQL Gambit

Mozilla Taskcluster에서 2026년에 공개된 고액 bug-bounty RCE의 핵심 신뢰 경계를 축소 모델링한 독립형 Docker Web CTF입니다.

> 교육 및 승인된 로컬 CTF 용도입니다. 실제 인터넷 서비스에 payload를 전송하지 마십시오.

## Challenge profile

- 난이도: DreamHack Silver 후반 ~ Gold 초입
- 예상 시간: 45~100분
- 체인: source map/schema 탐색 → open GraphQL JSON filter → sift-style `$where` → `new Function` code execution → reflected error로 flag exfiltration
- 공개 확인 bounty: HackerOne Hacktivity 표시 기준 **US$12,000**
- 기본 주소: `http://127.0.0.1:18081`
- 요구 사항: Docker Engine 또는 Docker Desktop, Docker Compose v2, Node.js 22 이상

## Quick start / 빠른 실행

의존성 설치나 수동 secret 설정은 필요하지 않습니다.

```bash
git clone https://github.com/sigure21/ctf-graphql-gambit.git
cd ctf-graphql-gambit
node scripts/ctf.mjs up
```

런처는 다음을 자동 처리합니다.

1. `.runtime/config.json`에 random flag와 내부 proxy secret 생성
2. hardened Docker image build
3. localhost 전용 서비스 시작
4. healthcheck 대기
5. 정상·실패·의도 exploit 회귀 테스트

다른 포트를 사용하려면:

```bash
node scripts/ctf.mjs up --port 19081
```

## Operator commands

```text
node scripts/ctf.mjs up [--port N]  생성·빌드·시작·검증
node scripts/ctf.mjs verify         live regression 재실행
node scripts/ctf.mjs status         container 상태
node scripts/ctf.mjs flags          현재 organizer flag 출력
node scripts/ctf.mjs logs           최근 로그
node scripts/ctf.mjs logs --follow  로그 추적
node scripts/ctf.mjs down           종료; runtime secret 보존
node scripts/ctf.mjs reset          종료 후 flag/secret 회전 및 재시작
node scripts/ctf.mjs doctor         Node/Docker/Compose/daemon 진단
```

Runtime state는 Git에서 제외된 `.runtime/`에만 저장됩니다. 실제 flag나 token을 repository에 넣지 마십시오.

## Participant handout

참가자에게는 [handout/README.md](handout/README.md)와 challenge URL만 전달하십시오. `solver/`와 `organizer/`는 출제자 전용입니다.

## Verified public basis

- [Taskcluster 공식 advisory — GHSA-ccv5-c45x-2q38](https://github.com/taskcluster/taskcluster/security/advisories/GHSA-ccv5-c45x-2q38)
- [HackerOne 공개 report #3782701](https://hackerone.com/reports/3782701)
- [HackerOne Hacktivity](https://hackerone.com/hacktivity/overview?queryString=graphql%20AND%20disclosed%3Atrue)

2026-11-01 확인 시 공식 GHSA는 2026-06-11 공개, Critical, affected `< 100.3.0`, patched `100.3.0`, `CVE-2026-11892`를 표시합니다. HackerOne Hacktivity는 해당 Mozilla report의 bounty를 US$12,000으로 표시합니다.

### Identifier caveat

GHSA와 NVD의 CVE metadata/노출 시점이 일치하지 않을 수 있고, 작성 시점에는 NVD 상세 내용을 독립적으로 안정 확인하지 못했습니다. 이 repository는 **GHSA-ccv5-c45x-2q38을 canonical 근거**로 사용하며 NVD의 별도 설명·점수는 주장하지 않습니다. CVE 문자열은 GHSA가 표시하는 매핑만 기록합니다.

## Model boundary

실제 Taskcluster 또는 sift package를 포함하지 않습니다. 표준 Node.js `new Function`으로 공식 advisory의 핵심 동작을 재현하며 schema, dataset, `filter.tasks` 중첩, worker timeout은 CTF 안정성과 난이도를 위한 가상 구성입니다. 실제 제품의 1:1 PoC가 아닙니다.

## Isolation

- 공개 port는 기본적으로 `127.0.0.1`에만 bind됩니다.
- 취약 evaluator는 host에 publish되지 않는 `internal: true` network에만 연결됩니다.
- non-root, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, PID/CPU/memory 제한을 적용합니다.
- host bind mount, Docker socket, privileged mode, host network를 사용하지 않습니다.
- 무한 loop payload는 별도 worker에서 750ms 뒤 종료합니다.
- flag 외 실제 secret을 evaluator에 전달하지 마십시오.

Docker는 완전한 보안 경계라고 단정할 수 없습니다. 신뢰할 수 없는 참가자에게 제공할 때는 참가자별 VM/instance 등 추가 격리를 사용하십시오.

## Repository layout

```text
src/gateway.mjs        공개 UI/GraphQL reverse gateway
src/evaluator.mjs      외부 미노출 GraphQL resolver
src/filter-worker.mjs  시간·memory 제한된 취약 filter evaluator
scripts/ctf.mjs        cross-platform zero-touch operator CLI
tests/challenge.mjs    live regression
solver/solve.mjs       organizer reference exploit
handout/README.md      participant statement
organizer/             write-up, hints, deployment, unintended checks
```

## Development

Docker 없이 정적 검사를 실행할 수 있습니다.

```bash
npm test
```

Live instance가 실행 중이면:

```bash
node scripts/ctf.mjs verify
CHALLENGE_URL=http://127.0.0.1:18081 node solver/solve.mjs
```

PowerShell에서는 마지막 명령 전 `$env:CHALLENGE_URL='http://127.0.0.1:18081'`를 사용하십시오.

## License

Original educational code is released under the [MIT License](LICENSE). Third-party product names and advisory content remain the property of their respective owners.
