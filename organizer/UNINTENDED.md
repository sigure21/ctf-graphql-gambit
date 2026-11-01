# Unintended-solve Checklist

- [ ] 홈페이지, JS, source map, schema, 정상 query에 flag가 없다.
- [ ] `PROXY_SECRET`은 어떤 외부 응답에도 노출되지 않는다.
- [ ] evaluator port가 host에 publish되지 않는다.
- [ ] `/internal/graphql`은 공개 gateway에서 404다.
- [ ] query 문자열 주입과 잘못된 filter 중첩으로 flag를 얻을 수 없다.
- [ ] `$where`는 오직 의도한 `filter.tasks` 경로에서 실행된다.
- [ ] 무한 loop payload는 worker timeout으로 종료된다.
- [ ] request/output 크기와 worker memory 제한이 유지된다.
- [ ] host mount와 Docker socket이 없다.
- [ ] `.runtime/`은 Git에서 제외되고 실제 secret이 tracked file에 없다.

검증:

```bash
npm test
node scripts/ctf.mjs up
node scripts/ctf.mjs verify
node scripts/ctf.mjs down
```

배포 뒤 `docker compose config`, container network, 공개 bind address를 별도로 확인하십시오.
