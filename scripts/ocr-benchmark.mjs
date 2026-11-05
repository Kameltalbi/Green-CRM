import "dotenv/config";
import fs from "fs";
import path from "path";
import {createRequire} from "module";

const require = createRequire(import.meta.url);
const {extractDocument} = require("../lib/document-ai.js");
const dir = process.env.OCR_BENCH_DIR || "/tmp/ciblix-ocr-bench";
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function fold(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function picked(result, expect) {
  const contact = (result.contacts || []).find(item => fold(item.name) === fold(expect.contact)) || result.contacts?.[0] || {};
  const company = (result.companies || []).find(item => fold(item.name) === fold(expect.company)) || result.companies?.[0] || {};
  return {
    company: company.name || "",
    contact: contact.name || "",
    job: contact.job_title || "",
    phone: contact.phone || "",
    phone_work: contact.phone_work || "",
    whatsapp: contact.whatsapp || "",
    email: (contact.emails || [])[0] || "",
    company_phone: company.phone || "",
    company_email: company.email || "",
    city: company.city || "",
    country: company.country || "",
    website: company.website || "",
    address: company.address || ""
  };
}

function same(field, expected, actual) {
  if (field.includes("phone") || field === "whatsapp") return digits(expected) === digits(actual);
  if (field.includes("email")) return fold(expected) === fold(actual);
  if (field === "website") return fold(expected).replace(/^https?:\/\//, "").replace(/\/$/, "") === fold(actual).replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (field === "address") return fold(actual).includes(fold(expected));
  return fold(expected) === fold(actual);
}

function phonePool(values) {
  return values.map(digits).filter(value => value.length >= 8);
}

function emailPool(values) {
  return values.map(fold).filter(value => value.includes("@"));
}

const only = new Set(String(process.env.OCR_ONLY || "").split(",").map(item => item.trim()).filter(Boolean));
const rows = [];
for (const card of manifest) {
  if (only.size && !only.has(card.id)) continue;
  const started = Date.now();
  const data = fs.readFileSync(path.join(dir, card.file)).toString("base64");
  let result = null;
  let error = "";
  try {
    result = await extractDocument({mimeType: "image/jpeg", data});
  } catch (cause) {
    error = String(cause.code || cause.providerStatus || "error");
  }
  const ms = Date.now() - started;
  const fields = result ? picked(result, card.expect) : {};
  const actualPhones = phonePool([
    ...(result?.contacts || []).flatMap(item => [item.phone, item.phone_work, item.whatsapp]),
    ...(result?.companies || []).map(item => item.phone)
  ]);
  const actualEmails = emailPool([
    ...(result?.contacts || []).flatMap(item => item.emails || []),
    ...(result?.companies || []).map(item => item.email)
  ]);
  const checks = [];
  for (const [field, expected] of Object.entries(card.expect)) {
    const actual = fields[field] || "";
    let found = false;
    if (result && expected !== "") {
      if (/phone|whatsapp/.test(field)) found = actualPhones.includes(digits(expected));
      else if (field.includes("email")) found = actualEmails.includes(fold(expected));
      else found = same(field, expected, actual);
    }
    checks.push({
      field,
      ok: expected === "" ? (result ? same(field, expected, actual) : false) : found,
      found,
      invented: expected === "" && String(actual).trim() !== ""
    });
  }
  const expectedPhones = phonePool(Object.entries(card.expect).filter(([field]) => /phone|whatsapp/.test(field)).map(([, value]) => value));
  const expectedEmails = emailPool(Object.entries(card.expect).filter(([field]) => field.includes("email")).map(([, value]) => value));
  for (const value of actualPhones) {
    if (!expectedPhones.includes(value)) checks.push({field: "phone_extra", ok: false, invented: true});
  }
  for (const value of actualEmails) {
    if (!expectedEmails.includes(value)) checks.push({field: "email_extra", ok: false, invented: true});
  }
  rows.push({
    id: card.id,
    lang: card.lang,
    usable: card.usable,
    ok: Boolean(result),
    error,
    ms,
    model: result?.meta?.model || "",
    checks
  });
  const failed = checks.filter(item => !item.ok).map(item => item.field);
  console.log([card.id, result ? "ok" : "fail", ms + "ms", failed.join(",") || "-"].join(" | "));
}

function rate(list) {
  if (!list.length) return null;
  return list.filter(Boolean).length / list.length;
}

const usable = rows.filter(row => row.usable);
const phoneEmail = [];
for (const row of usable) {
  const card = manifest.find(item => item.id === row.id);
  for (const check of row.checks) {
    if (!/phone|email|whatsapp/.test(check.field) || check.field.endsWith("_extra")) continue;
    if (!card.expect[check.field]) continue;
    phoneEmail.push(check.found);
  }
}
const corrections = usable.reduce((sum, row) => sum + row.checks.filter(item => !item.ok).length, 0);
const summary = {
  cards: rows.length,
  usable: usable.length,
  technicalSuccessAll: rate(rows.map(row => row.ok)),
  technicalSuccessUsable: rate(usable.map(row => row.ok)),
  phoneEmailAccuracyUsable: rate(phoneEmail),
  correctionsOnUsableCards: corrections,
  meanMs: Math.round(rows.reduce((sum, row) => sum + row.ms, 0) / rows.length),
  inventions: rows.reduce((sum, row) => sum + row.checks.filter(item => item.invented).length, 0)
};
const reportName = only.size ? "report-retry.json" : "report.json";
fs.writeFileSync(path.join(dir, reportName), JSON.stringify({summary, rows}, null, 2));
console.log("SUMMARY", JSON.stringify(summary));
