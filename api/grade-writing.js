const GEMINI_ENDPOINT="https://generativelanguage.googleapis.com/v1beta/models";

function sendJson(res,status,body){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.end(JSON.stringify(body));
}

function parseJsonBody(req){
  return new Promise((resolve,reject)=>{
    let raw="";
    req.on("data",chunk=>{
      raw+=chunk;
      if(raw.length>5_000_000){
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });
    req.on("end",()=>{
      try{resolve(raw?JSON.parse(raw):{});}
      catch(err){reject(err);}
    });
    req.on("error",reject);
  });
}

function extractImage(imageData){
  const match=String(imageData||"").match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if(!match)return null;
  return {mimeType:`image/${match[1]}`,data:match[2]};
}

function safeJson(text){
  const cleaned=String(text||"").replace(/```json|```/g,"").trim();
  try{return JSON.parse(cleaned);}
  catch{
    const match=cleaned.match(/\{[\s\S]*\}/);
    return match?JSON.parse(match[0]):null;
  }
}

async function askGemini({parts,temperature=0.2,responseMimeType}){
  const apiKey=process.env.GEMINI_API_KEY;
  if(!apiKey)throw new Error("missing_gemini_api_key");
  const model=process.env.GEMINI_MODEL||"gemini-2.5-flash-lite";
  const geminiRes=await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      contents:[{role:"user",parts}],
      generationConfig:{
        temperature,
        ...(responseMimeType?{responseMimeType}:{})
      }
    })
  });
  const geminiData=await geminiRes.json().catch(()=>({}));
  if(!geminiRes.ok)throw new Error(geminiData.error?.message||"gemini_request_failed");
  return geminiData.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("")||"";
}

async function handleKanjiWriting(body){
  const image=extractImage(body.imageData);
  if(!image)return {status:400,body:{error:"missing_image"}};
  const prompt=[
    "あなたは静岡県の中学3年生向け国語の漢字書き取り採点者です。",
    "手書き画像を見て、指定された漢字を書けているかを厳しく、ただし短く優しく判定してください。",
    "返答はJSONのみです。",
    '{"verdict":"correct|partial|wrong","comment":"40字以内","nextTip":"30字以内"}',
    `正解漢字: ${body.kanji}`,
    `読み: ${body.reading}`,
    `意味: ${body.meaning||""}`,
    `例文: ${body.example||""}`,
    `お手本を見たか: ${body.sampleShown?"はい":"いいえ"}`,
    "判定基準: 字形が明らかに正しければcorrect、少し崩れているが識別できるならpartial、別字・未記入・読めない場合はwrong。"
  ].join("\n");
  const text=await askGemini({temperature:0.1,responseMimeType:"application/json",parts:[
    {text:prompt},
    {inline_data:{mime_type:image.mimeType,data:image.data}}
  ]});
  const parsed=safeJson(text);
  if(!parsed)return {status:502,body:{error:"invalid_gemini_response"}};
  const verdict=["correct","partial","wrong"].includes(parsed.verdict)?parsed.verdict:"wrong";
  return {status:200,body:{
    verdict,
    comment:String(parsed.comment||"採点しました。").slice(0,80),
    nextTip:String(parsed.nextTip||"形を見直してもう一度書こう。").slice(0,80)
  }};
}

async function handleKanjiHint(body){
  const prompt=[
    "受験生向け漢字記憶の専門家として、JSONのみで返してください。",
    '{"tip":"覚え方30字以内","story":"イメージ15字以内","similar":"混同注意。なければ空"}',
    `漢字: ${body.kanji}`,
    `読み: ${body.reading}`,
    `意味: ${body.meaning||""}`
  ].join("\n");
  const parsed=safeJson(await askGemini({temperature:0.4,responseMimeType:"application/json",parts:[{text:prompt}]}));
  if(!parsed)return {status:502,body:{error:"invalid_gemini_response"}};
  return {status:200,body:{
    tip:String(parsed.tip||"形と意味を結びつけよう。").slice(0,60),
    story:String(parsed.story||"").slice(0,40),
    similar:String(parsed.similar||"").slice(0,40)
  }};
}

async function handleEssayFeedback(body){
  const prompt=[
    "あなたは高校受験の国語作文の先生です。中学生に向けて優しく、具体的に添削してください。",
    "観点: ①字数・条件 ②主張 ③理由・具体例 ④文章のまとまり ⑤改善ポイント1つ。",
    "300字以内で返してください。",
    `テーマ: ${body.theme}`,
    `条件: ${(body.conditions||[]).join("、")}`,
    `字数条件: ${body.minChar}〜${body.maxChar}字`,
    `作文:\n${body.text||""}`
  ].join("\n");
  const feedback=await askGemini({temperature:0.3,parts:[{text:prompt}]});
  return {status:200,body:{feedback:String(feedback||"添削できませんでした。").slice(0,600)}};
}

export default async function handler(req,res){
  if(req.method==="OPTIONS")return sendJson(res,204,{});
  if(req.method!=="POST")return sendJson(res,405,{error:"method_not_allowed"});
  let body;
  try{body=await parseJsonBody(req);}
  catch{return sendJson(res,400,{error:"invalid_json"});}
  try{
    const result=body.mode==="kanji-writing"
      ? await handleKanjiWriting(body)
      : body.mode==="kanji-hint"
        ? await handleKanjiHint(body)
        : body.mode==="essay-feedback"
          ? await handleEssayFeedback(body)
          : {status:400,body:{error:"unsupported_mode"}};
    return sendJson(res,result.status,result.body);
  }catch(err){
    const missing=err.message==="missing_gemini_api_key";
    return sendJson(res,missing?500:502,{error:missing?"missing_gemini_api_key":"gemini_request_failed",detail:missing?undefined:err.message});
  }
}
