# Deployment

## Zero-touch path

```bash
node scripts/ctf.mjs doctor
node scripts/ctf.mjs up
```

`up`은 random flag/secret 생성, image build, healthcheck, regression을 수행합니다. 기본 주소는 `http://127.0.0.1:18081`입니다.

다른 포트:

```bash
node scripts/ctf.mjs up --port 19081
```

현재 flag 확인과 종료:

```bash
node scripts/ctf.mjs flags
node scripts/ctf.mjs down
```

## Isolation requirements

- evaluator는 외부에 publish하지 않고 `internal: true` backplane에만 둡니다.
- Docker socket, host bind mount, `privileged`, host network를 추가하지 않습니다.
- flag 외 실제 secret을 evaluator 환경에 넣지 않습니다.
- non-root, read-only rootfs, capability 제거, no-new-privileges, PID/CPU/memory 제한을 유지합니다.
- 참가자별 instance 또는 신뢰되지 않은 참가자 사이의 강한 격리를 권장합니다.
- 인터넷에 직접 공개하지 마십시오. 행사 proxy를 둘 때 body/header/timeout 제한을 유지합니다.

## Runtime data

`.runtime/config.json`에는 현재 flag와 proxy secret이 저장되며 `.gitignore` 대상입니다. 배포 백업이나 artifact에 포함하지 마십시오. `reset`은 이 파일만 삭제한 뒤 새 값을 생성합니다.
