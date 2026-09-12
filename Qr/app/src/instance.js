// 이 인스턴스가 방금 떴는가, 아니면 계속 살아 있었는가.
//
// 2026-09-12 사장님: "근데 버셀이나 몽고 둘 다 서버가 서울인데?"
//
// 맞는 지적이다. 2026-09-10 에 함수 리전을 서울로 옮겨 몽고 왕복이
// 178ms → 3ms 가 됐다. **따뜻한 인스턴스에서는 몽고가 느릴 수가 없다.**
// 그런데도 버튼이 느리다면 남은 후보는 「매번 새로 뜨는 인스턴스」다.
// 새 인스턴스는 함수 번들(지금 6MB 남짓)을 풀고, Atlas 로 TLS 를 새로 맺고,
// 모듈을 전부 읽어들인 다음에야 첫 줄을 실행한다. 그건 3ms 짜리가 아니다.
//
// 그래서 요청마다 이 인스턴스가 몇 번째를 처리하는지 센다. /api/_diag 에서
// requests_served 가 계속 1~2 로 나오면 요청마다 새 인스턴스가 뜨고 있다는
// 뜻이고, 그때는 왕복 횟수를 줄이는 것이 거의 아무 소용이 없다.
let requestsServed = 0;

function countRequest() {
  requestsServed++;
}

function stats() {
  return {
    requests_served: requestsServed,
    instance_age_s: Math.round(process.uptime()),
  };
}

module.exports = { countRequest, stats };
