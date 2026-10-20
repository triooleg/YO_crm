import test from "node:test";
import assert from "node:assert/strict";
import { countryOptions, countryChoices, findCountry, countryMatchesPrefix } from "../lib/country-options.mjs";

test("country picker includes all ISO countries with flags and prefix search in Russian or English", () => {
  assert.equal(countryOptions.filter(option=>option.code !== "xk").length,249);
  assert.equal(new Set(countryOptions.map(option=>option.code)).size,countryOptions.length);
  assert.ok(countryOptions.every(option=>/^[a-z]{2}$/.test(option.code)));
  const france=findCountry("France");
  assert.ok(countryMatchesPrefix(france,"фра"));
  assert.ok(countryMatchesPrefix(france,"Fra"));
  assert.equal(countryMatchesPrefix(france,"ance"),false);
  assert.equal(findCountry("США").code,"us");
  assert.equal(findCountry("US United States").code,"us");
});
test("legacy and unknown country values round trip until explicit selection",()=>{
  for(const value of ["США","US United States","Неизвестное название"])
    assert.equal(countryChoices(value)[0].value,value);
});
