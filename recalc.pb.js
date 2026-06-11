/// <reference path="../pb_data/types.d.ts" />

// ─── RECALCULAR VOTOS ────────────────────────────────────────
function recalcVotes(topicId) {
  try {
    const result = $app.dao().db()
      .newQuery(`SELECT
        SUM(CASE WHEN value='up'   THEN 1 ELSE 0 END) as up,
        SUM(CASE WHEN value='down' THEN 1 ELSE 0 END) as down,
        COUNT(*) as total
        FROM votes WHERE topic = {:topicId}`)
      .bind({ topicId })
      .one();

    const topic = $app.dao().findRecordById("topics", topicId);
    topic.set("votes_up",    result.up    || 0);
    topic.set("votes_down",  result.down  || 0);
    topic.set("votes_total", result.total || 0);
    $app.dao().saveRecord(topic);
  } catch(e) {
    console.error("recalcVotes:", String(e));
  }
}

onRecordAfterCreateRequest((e) => { recalcVotes(e.record.get("topic")); }, "votes");
onRecordAfterUpdateRequest((e) => { recalcVotes(e.record.get("topic")); }, "votes");
onRecordAfterDeleteRequest((e) => { recalcVotes(e.record.get("topic")); }, "votes");

// ─── RECALCULAR RATING ───────────────────────────────────────
function recalcRating(topicId) {
  try {
    const result = $app.dao().db()
      .newQuery(`SELECT AVG(value) as avg, COUNT(*) as cnt
        FROM ratings WHERE topic = {:topicId}`)
      .bind({ topicId })
      .one();

    const topic = $app.dao().findRecordById("topics", topicId);
    topic.set("rating_avg",   result.avg ? Math.round(result.avg * 10) / 10 : 0);
    topic.set("rating_count", result.cnt || 0);
    $app.dao().saveRecord(topic);
  } catch(e) {
    console.error("recalcRating:", String(e));
  }
}

onRecordAfterCreateRequest((e) => { recalcRating(e.record.get("topic")); }, "ratings");
onRecordAfterUpdateRequest((e) => { recalcRating(e.record.get("topic")); }, "ratings");
onRecordAfterDeleteRequest((e) => { recalcRating(e.record.get("topic")); }, "ratings");

// ─── RECALCULAR COMENTARIOS ──────────────────────────────────
function recalcComments(topicId) {
  try {
    const result = $app.dao().db()
      .newQuery("SELECT COUNT(*) as cnt FROM comments WHERE topic = {:topicId}")
      .bind({ topicId })
      .one();

    const topic = $app.dao().findRecordById("topics", topicId);
    topic.set("comments_count", result.cnt || 0);
    $app.dao().saveRecord(topic);
  } catch(e) {
    console.error("recalcComments:", String(e));
  }
}

onRecordAfterCreateRequest((e) => { recalcComments(e.record.get("topic")); }, "comments");
onRecordAfterDeleteRequest((e) => { recalcComments(e.record.get("topic")); }, "comments");

// ─── VALIDAR 1 VOTO por usuario/tema ─────────────────────────
onRecordBeforeCreateRequest((e) => {
  const userId  = e.record.get("user");
  const topicId = e.record.get("topic");
  try {
    $app.dao().findFirstRecordByFilter("votes", `user='${userId}' && topic='${topicId}'`);
    throw new BadRequestError("Ya has votado en este tema");
  } catch(e) {
    if (String(e).includes("Ya has votado")) throw e;
    // no existe → OK
  }
}, "votes");

// ─── VALIDAR 1 COMENTARIO por usuario/tema ───────────────────
onRecordBeforeCreateRequest((e) => {
  const userId  = e.record.get("user");
  const topicId = e.record.get("topic");
  try {
    $app.dao().findFirstRecordByFilter("comments", `user='${userId}' && topic='${topicId}'`);
    throw new BadRequestError("Solo puedes comentar una vez por tema");
  } catch(e) {
    if (String(e).includes("Solo puedes comentar")) throw e;
  }
}, "comments");
