import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const engine=html.match(/<script id="scope-engine">([\s\S]*?)<\/script>/)?.[1]||"";
const context={};vm.createContext(context);
vm.runInContext(`${engine};globalThis.scopeApi={defaultLearnedTopicIds,isQuestionAvailable,filterAvailableQuestions,skipUnlearnedTopic}`,context);
const api=context.scopeApi;

const topics=[
 {id:"reading",grade:1},
 {id:"grammar",grade:2},
 {id:"essay",grade:3}
];

test("grade 1 and 2 topics are learned by default",()=>{
 assert.deepEqual([...api.defaultLearnedTopicIds(topics)],["reading","grammar"]);
});

test("unlearned topics and unmet prerequisites are filtered",()=>{
 assert.equal(api.isQuestionAvailable({topicId:"reading",prerequisites:[]},["reading"]),true);
 assert.equal(api.isQuestionAvailable({topicId:"essay",prerequisites:["grammar"]},["reading","grammar"]),false);
 assert.deepEqual(api.filterAvailableQuestions([
  {id:"a",topicId:"reading",prerequisites:[]},
  {id:"b",topicId:"essay",prerequisites:["grammar"]}
 ],["reading","grammar"]).map(q=>q.id),["a"]);
});

test("skipping a topic removes it and matching deck questions",()=>{
 const result=api.skipUnlearnedTopic(
  {learnedTopics:["reading","essay"]},
  "essay",
  [{id:"a",topicId:"essay"},{id:"b",topicId:"reading"}]
 );
 assert.deepEqual([...result.learnedTopics],["reading"]);
 assert.deepEqual([...result.deck.map(q=>q.id)],["b"]);
});

test("all learning formats expose scope controls",()=>{
 for(const id of ["screen-scope","quiz-unlearned-btn","kaki-unlearned-btn","essay-unlearned-btn"])assert.match(html,new RegExp(`id="${id}"`));
 for(const handler of ["showScope","toggleTopic","saveScope","markCurrentTopicUnlearned"])assert.match(html,new RegExp(`window\\.${handler}\\s*=\\s*${handler}`));
});

test("all inline scripts have valid JavaScript syntax",()=>{
 for(const source of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1])){
  assert.doesNotThrow(()=>new Function(source));
 }
});
