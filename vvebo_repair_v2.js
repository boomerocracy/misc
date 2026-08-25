/*
 * VVebo 3.3.31 timeline repair for Loon.
 * Adds per-user first-page caching, pagination protection and safe fallbacks.
 */

const requestUrl =
  typeof $request !== "undefined" && $request.url ? $request.url : "";
const currentUidKey = "vvebo_current_uid_v2";
const cachePrefix = "vvebo_timeline_v2_";
const maxCacheLength = 512 * 1024;

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

function uidFromContainer(url) {
  const containerId = getParam(url, "containerid") || "";
  const match = containerId.match(/^230413(\d+)(?:_|$)/);
  return match ? match[1] : null;
}

function getUid(url) {
  const directUid = getParam(url, "uid");
  if (validUid(directUid)) return directUid;

  const containerUid = uidFromContainer(url);
  if (validUid(containerUid)) return containerUid;

  const cachedUid = $persistentStore.read(currentUidKey);
  return validUid(cachedUid) ? cachedUid : null;
}

function rememberUid(uid) {
  if (validUid(uid)) $persistentStore.write(uid, currentUidKey);
}

function emptyTimeline() {
  return JSON.stringify({
    statuses: [],
    since_id: 0,
    total_number: 0,
  });
}

function isFirstPage(url) {
  const cursor = getParam(url, "since_id") || getParam(url, "max_id");
  return cursor == null || cursor === "" || cursor === "0";
}

function cacheKey(uid) {
  return cachePrefix + uid;
}

function saveFirstPage(uid, body) {
  if (validUid(uid) && body.length <= maxCacheLength) {
    $persistentStore.write(body, cacheKey(uid));
  }
}

function fallbackTimeline(uid, firstPage, reason) {
  console.log("VVebo timeline fallback: " + reason);

  if (firstPage && validUid(uid)) {
    const cachedBody = $persistentStore.read(cacheKey(uid));
    if (cachedBody) {
      console.log("VVebo: returning cached timeline for uid " + uid);
      $done({ body: cachedBody });
      return;
    }
  }

  $done({ body: emptyTimeline() });
}

try {
  if (
    requestUrl.includes("/users/show") ||
    requestUrl.includes("/remind/unread_count")
  ) {
    rememberUid(getParam(requestUrl, "uid"));
    $done({});
  } else if (requestUrl.includes("/statuses/user_timeline")) {
    const uid = getUid(requestUrl);

    if (!validUid(uid)) {
      console.log("VVebo: no valid uid; leaving request unchanged");
      $done({});
    } else {
      rememberUid(uid);

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
    const uid = getUid(requestUrl);
    const firstPage = isFirstPage(requestUrl);

    try {
      const responseBody =
        typeof $response !== "undefined" && $response.body
          ? $response.body
          : "";
      const responseStatus =
        typeof $response !== "undefined" && $response.status
          ? Number($response.status)
          : 200;

      if (!responseBody) throw new Error("empty response");
      if (responseStatus < 200 || responseStatus >= 300) {
        throw new Error("HTTP " + responseStatus);
      }

      const data = JSON.parse(responseBody);
      if (!Array.isArray(data.cards)) {
        const apiMessage = data.msg || data.message || data.errmsg || "cards missing";
        throw new Error(apiMessage);
      }

      const statuses = [];

      data.cards.forEach((card) => {
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

      const nextCursor =
        data.cardlistInfo && data.cardlistInfo.since_id != null
          ? data.cardlistInfo.since_id
          : 0;
      const convertedBody = JSON.stringify({
        statuses: statuses,
        since_id: nextCursor,
        total_number: 100,
      });

      if (firstPage && statuses.length > 0) {
        saveFirstPage(uid, convertedBody);
      }

      $done({ body: convertedBody });
    } catch (error) {
      fallbackTimeline(uid, firstPage, String(error));
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
    fallbackTimeline(getUid(requestUrl), isFirstPage(requestUrl), String(error));
  } else {
    $done({});
  }
}
