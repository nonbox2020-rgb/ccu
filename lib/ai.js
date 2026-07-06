"use strict";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const API_VERSION = "2023-06-01";

function hasKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function callAnthropic(messages, maxTokens = 2000) {
  if (!hasKey()) throw new Error("NO_API_KEY");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API_${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || "").join("");
}

function stripJson(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

/**
 * Ask the model to read the estimate (in whatever form) and return normalised
 * line items. `content` is the AI content block from extract.js.
 */
async function extractLineItems(content) {
  const instruction = `あなたは建築見積書を読み取る専門AIです。
与えられた見積書から、資材・工事の明細行をすべて抽出してください。
各行について次を推定してください（不明な場合はnull）:
- name: 品名・工事項目名（原文のまま）
- qty: 数量（数値のみ）
- unit: 単位（m2, 個, 式 など）
- unitPrice: 単価（円、数値のみ、カンマ・通貨記号は除去）
- amount: 金額・小計（円、数値のみ）

出力は必ず次のJSONのみ。前置き・説明・マークダウン記法は一切禁止。
{"items":[{"name":"...","qty":0,"unit":"...","unitPrice":0,"amount":0}]}`;

  let userContent;
  if (content.kind === "text") {
    userContent = [{ type: "text", text: `${instruction}\n\n--- 見積書 ---\n${content.text}` }];
  } else if (content.kind === "document") {
    userContent = [
      { type: "document", source: { type: "base64", media_type: content.mediaType, data: content.base64 } },
      { type: "text", text: instruction },
    ];
  } else if (content.kind === "image") {
    userContent = [
      { type: "image", source: { type: "base64", media_type: content.mediaType, data: content.base64 } },
      { type: "text", text: instruction },
    ];
  } else {
    throw new Error("UNSUPPORTED_CONTENT");
  }

  const raw = await callAnthropic([{ role: "user", content: userContent }], 3000);
  const parsed = JSON.parse(stripJson(raw));
  if (!parsed.items || !Array.isArray(parsed.items)) throw new Error("BAD_EXTRACTION");
  return parsed.items;
}

/**
 * Given the already-computed matched rows + totals, generate sales copy.
 */
async function generateCommentary(matchedRows, totals) {
  const payload = matchedRows.map((r, i) => ({
    index: i,
    original: r.name,
    qty: r.qty,
    unit: r.unit,
    proposed: r.product.name,
    costDiffYen: Math.round(r.costDiff),
    co2DiffKg: Math.round(r.co2Diff),
    co2DiffPercent: Math.round(r.co2DiffPercent),
  }));

  const prompt = `あなたはTBM社（環境素材LIMEX / CR LIMEXメーカー）の営業提案AIです。
以下は建築見積書のうち、TBM製品への置き換えが可能と判定された明細です（JSON）。数値はすでに確定済みです。

${JSON.stringify(payload, null, 2)}

合計: コスト差額 ${Math.round(totals.costSaving)}円 / CO2削減 ${Math.round(totals.co2Saving)}kg（約${Math.round(totals.co2Percent)}%）

タスク:
1) 各明細に、営業担当が施主へそのまま提示できる一文コメント（30〜55字、確定数値を含め、前向きかつ具体的に）。
2) 経営層・意思決定者向けの総括コメント（3〜4文。コスト効果・CO2削減効果・カーボンニュートラル方針との整合・営業ツールとしての価値に言及）。

出力は必ず次のJSONのみ。前置き・マークダウン記法は禁止。
{"comments":["...","..."],"summary":"..."}`;

  const raw = await callAnthropic([{ role: "user", content: [{ type: "text", text: prompt }] }], 1500);
  const parsed = JSON.parse(stripJson(raw));
  if (!parsed.comments || !parsed.summary) throw new Error("BAD_COMMENTARY");
  return parsed;
}

/* ------------------------ deterministic fallbacks ------------------------ */

const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

function fallbackComment(r) {
  const pct = Math.round(r.co2DiffPercent);
  const cost = r.costDiff >= 0 ? `${yen(r.costDiff)}のコスト削減` : `${yen(Math.abs(r.costDiff))}のコスト増`;
  return `${r.product.name}への切替でCO2を約${pct}%削減、${cost}が見込めます。`;
}

function fallbackSummary(totals) {
  const co2 =
    Math.abs(totals.co2Saving) >= 1000
      ? `${(totals.co2Saving / 1000).toFixed(2)}t-CO2`
      : `${Math.round(totals.co2Saving)}kg-CO2`;
  const costText =
    totals.costSaving >= 0
      ? `${yen(totals.costSaving)}のコスト削減`
      : `${yen(Math.abs(totals.costSaving))}のコスト増（環境価値との差額）`;
  return `本見積書のうち${totals.count}項目を対象製品へ置き換えることで、合計${costText}と${co2}（約${Math.round(
    totals.co2Percent
  )}%）のCO2削減が見込まれます。カーボンニュートラル方針に沿った提案として、価格競争力と環境価値の両面を訴求できます。`;
}

module.exports = { hasKey, extractLineItems, generateCommentary, fallbackComment, fallbackSummary };
Done
ちょっと待ってください。1つずつコピペする方法は、これまでの経緯を見るとまた取り違えや中身の欠けが起きるリスクが高いです。12ファイルもあるので、もっと確実な方法に切り替えましょう。

実は、GitHubには「ドラッグせずにフォルダを保った状態でアップロードできる、もっと簡単な入口」があります。それは、あなたのPCにある展開済みフォルダ全体を、一気にアップロードする方法です。

まず、今の状況を整理します。今の画面（アップロード欄に7ファイルが入っている状態）は、トップ直下のファイルだけなら正しくアップロードできることを示しています。問題はlibとpublicフォルダだけです。

そこで、今の画面はこのまま活かしましょう。

今すぐやること（この画面で）

download と download (1) を × で削除（この2つは余計なファイルです）
残った7ファイルで Commit changes をクリック → トップ直下は完成
次に、libとpublicをフォルダごとアップする方法

Commitが終わったら、もう一度 Add file → Upload files の画面を開いてください。そして今度は、ファイルではなくフォルダを選びます。

Windowsの場合、アップロード欄の「choose your files」というリンクをクリックすると、ファイル選択ダイアログではなく、ドラッグでフォルダを落とす動作が必要です。ドラッグがうまくいかないなら、次の裏技を使ってください。

裏技：エクスプローラーのアドレスバーからlibフォルダを開いて、中身を「パス付き」で認識させる

正直、ここが環境依存で難しいところです。そこで確認させてください。今アップロード画面でlibフォルダをドラッグして落とそうとすると、どうなりますか？

A：libフォルダをドラッグしても、アップロード欄が反応しない（何も起きない）
B：libフォルダをドラッグすると、中のai.jsなどが直下にバラけて入る（lib/が付かない）
C：そもそもフォルダをドラッグできない
このどれかを教えてください。それによって最適な方法が変わります。

もしフォルダのドラッグがどうしても無理なら、「Create new fileでパス付き（lib/ai.js）の名前を打って1つずつ作る」方法に切り替えます。その場合、12ファイルすべての中身を順番に、コピペしやすい形で出していきます（ai.jsは上に出したものが使えます）。手間はかかりますが、これなら100%確実にフォルダ構造ができます。

どちらで進めるか、上のA/B/Cと合わせて教えてください。

1783326249418_image.png
これで原因が完全に確定しました。今、extract.js・ai.js・login.html・style.css・settings.html・analyze.js・settings.js・products.jsが、すべてフォルダ名なしのファイル名だけでアップロード欄に入っています。

つまり、あなたのドラッグは問題B（フォルダをドラッグすると中身が直下にバラける、lib/やpublic/が付かない）の状態です。GitHubのこのアップロード欄が、フォルダ構造を保持できていません。これが今までずっと失敗していた根本原因です。

このままCommitしても絶対に動きません。 lib/やpublic/js/が付かないと、server.jsがファイルを見つけられないからです。

解決策：ドラッグをやめて、「名前を打って作る」方式に切り替えます。 これなら100%確実にフォルダ構造ができます。

まず、今のこのアップロードはキャンセルしてください（Commitせずに、ページを離れるか、全部×で消す）。ドラッグではlib/が付かないことが確定したので、この方法は使いません。

これから、12個のファイルを1つずつ「パス付きの名前」で作っていきます。GitHubは名前に/を入れると自動でフォルダを作るので、これが唯一確実な方法です。

順番にやっていきましょう。1個目です。

【ファイル1個目：lib/ai.js】

リポジトリのトップページで Add file → Create new file
上部のファイル名欄に、これを正確に入力：
   lib/ai.js
（lib と打って / を入れると、lib フォルダが自動でできます）
3. 下の大きな入力欄に、先ほど出したai.jsの中身（"use strict";で始まるもの）を全部貼り付け
4. 右上か下の Commit changes をクリック

これでlibフォルダとlib/ai.jsができます。

まず、この1個目（lib/ai.js）ができたら、「できた」と教えてください。1個成功すれば、あとは同じ操作の繰り返しです。残り11ファイルの中身を順番に出していきます。

焦らず1個ずつ確実にいきましょう。この方式なら、もうフォルダ構造が崩れることはありません。



