/*
 * VVebo 3.3.31 user timeline repair for Loon.
 *
 * Use this same script for the related request/response rewrite rules.
 * Every execution path calls $done exactly once.
 */

const requestUrl =
  typeof $request !== "undefined" && $request.url ? $request.url : "";
const uidKey = "vvebo_uid";

function getParam(url, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = url.match(new RegExp("[?&]" + escapedName + "=([^&#]*)"));

  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

function validUid(uid) {
  return typeof uid === "string" && /^\d+$/.test(uid);
}

function emptyTimeline() {
  return JSON.stringify({
    statuses: [],
    since_id: 0,
    total_number: 0,
  });
}

function finishWithEmptyTimeline(message) {
  if (message) console.log(message);
  $done({ body: emptyTimeline() });
}

try {
  if (
    requestUrl.includes("/users/show") ||
    requestUrl.includes("/remind/unread_count")
  ) {
    const uid = getParam(requestUrl, "uid");

    if (validUid(uid)) {
      $persistentStore.write(uid, uidKey);
    }

    $done({});
  } else if (requestUrl.includes("/statuses/user_timeline")) {
    const uid =
      getParam(requestUrl, "uid") || $persistentStore.read(uidKey);

    if (!validUid(uid)) {
      console.log("VVebo: no valid uid; leaving the original request unchanged");
      $done({});
    } else {
      let newUrl = requestUrl.replace(
        "/statuses/user_timeline",
        "/profile/statuses/tab"
      );

      newUrl = newUrl.replace(/([?&])max_id=/, "$1since_id=");

      if (!/[?&]containerid=/.test(newUrl)) {
        newUrl +=
          (newUrl.includes("?") ? "&" : "?") +
          "containerid=230413" +
          uid +
          "_-_WEIBO_SECOND_PROFILE_WEIBO";
      }

      $done({ url: newUrl });
    }
  } else if (requestUrl.includes("/profile/statuses/tab")) {
    try {
      const responseBody =
        typeof $response !== "undefined" && $response.body
          ? $response.body
          : "{}";
      const data = JSON.parse(responseBody);
      const sourceCards = Array.isArray(data.cards) ? data.cards : [];
      const statuses = [];

      sourceCards.forEach((card) => {
        const group = Array.isArray(card && card.card_group)
          ? card.card_group
          : [card];

        group.forEach((item) => {
          if (item && item.card_type === 9 && item.mblog) {
            const status = item.mblog;
            statuses.push(
              status.isTop
                ? Object.assign({}, status, { label: "置顶" })
                : status
            );
          }
        });
      });

      const sinceId =
        data.cardlistInfo && data.cardlistInfo.since_id != null
          ? data.cardlistInfo.since_id
          : 0;

      $done({
        body: JSON.stringify({
          statuses: statuses,
          since_id: sinceId,
          total_number: 100,
        }),
      });
    } catch (error) {
      finishWithEmptyTimeline("VVebo timeline conversion failed: " + error);
    }
  } else if (requestUrl.includes("selffans")) {
    try {
      const responseBody =
        typeof $response !== "undefined" && $response.body
          ? $response.body
          : "{}";
      const data = JSON.parse(responseBody);

      data.cards = Array.isArray(data.cards)
        ? data.cards.filter(
            (card) => card && card.itemid !== "INTEREST_PEOPLE2"
          )
        : [];

      $done({ body: JSON.stringify(data) });
    } catch (error) {
      console.log("VVebo fans conversion failed: " + error);
      $done({});
    }
  } else {
    $done({});
  }
} catch (error) {
  console.log("VVebo repair failed: " + error);

  if (requestUrl.includes("/profile/statuses/tab")) {
    finishWithEmptyTimeline();
  } else {
    $done({});
  }
}
