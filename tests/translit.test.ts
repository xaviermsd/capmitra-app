import { afterEach, describe, expect, it } from "vitest";
import { displayText, displayWord, englishLoan, romanizeWord, setRomanRules } from "@/lib/translit";

afterEach(() => setRomanRules(new Map()));

describe("Gujlish (casual Gujarati)", () => {
  const cases: [string, string][] = [
    ["નમસ્તે", "namaste"], ["ગુજરાત", "Gujarat"], ["કરીશું", "karishu"], ["મિત્રો", "mitro"], ["આપણે", "aapne"],
    ["વાત", "vat"], ["જ્ઞાન", "gnan"], ["ક્ષમા", "kshama"], ["કરવાનું", "karvanu"], ["છું", "chhu"], ["સમજવું", "samajvu"], ["અમદાવાદ", "Amdavad"],
  ];
  it.each(cases)("%s → %s", (gu, en) => expect(romanizeWord(gu, "casual")).toBe(en));

  it("keeps punctuation and turns the danda into a full stop", () => {
    expect(romanizeWord("ગુજરાત।", "casual")).toBe("Gujarat.");
    expect(romanizeWord("“નમસ્તે,", "casual")).toBe("“namaste,");
  });
});

describe("Hinglish / Roman Hindi", () => {
  const casual: [string, string][] = [
    ["नमस्ते", "namaste"], ["दोस्तों", "doston"], ["कमरा", "kamra"], ["समझना", "samajhna"], ["करना", "karna"],
    ["अपना", "apna"], ["करते", "karte"], ["सकता", "sakta"], ["बदलना", "badalna"], ["भारत", "Bharat"], ["शरबत", "sharbat"], ["काम", "kaam"],
    ["बात", "baat"], ["आज", "aaj"], ["खाना", "khana"], ["क्या", "kya"], ["है", "hai"], ["मैं", "main"], ["हैं", "hain"],
    ["ज़िंदगी", "zindagi"], ["इसलिए", "isliye"], ["प्यार", "pyaar"], ["गुजरात", "Gujarat"], ["रहा", "raha"], ["अंबर", "ambar"],
  ];
  it.each(casual)("%s → %s", (hi, en) => expect(romanizeWord(hi, "casual")).toBe(en));

  it("strict style doubles long vowels and keeps Hindi words Hindi", () => {
    expect(romanizeWord("खाना", "roman")).toBe("khaanaa");
    expect(romanizeWord("नहीं", "roman")).toBe("naheen");
    expect(romanizeWord("वीडियो", "roman")).not.toBe("video");
  });
});

describe("English loanwords (casual only)", () => {
  it("writes borrowed English words the English way in both scripts", () => {
    expect(englishLoan("वीडियो")).toBe("video");
    expect(englishLoan("विडियो")).toBe("video");
    expect(englishLoan("લાઇક")).toBe("like");
    expect(englishLoan("વિડિયો")).toBe("video");
    expect(englishLoan("શેર")).toBe("share");
  });
  it("handles a Gujarati ending glued to the loanword", () => {
    expect(romanizeWord("વિડિયોમાં", "casual")).toBe("video ma");
  });
  it("leaves ordinary words alone", () => {
    expect(englishLoan("ગુજરાત")).toBeUndefined();
  });
});

describe("display", () => {
  it("native text is untouched; Latin passes through", () => {
    expect(displayText("નમસ્તે CapMitra", "native")).toBe("નમસ્તે CapMitra");
    expect(displayText("નમસ્તે CapMitra", "casual")).toBe("namaste CapMitra");
    expect(displayText("નમસ્તે", "gujlish")).toBe("namaste"); // old project setting // old project setting
  });
  it("user spelling fixes and per-word spellings win", () => {
    setRomanRules("ગુજરાત = Gujju land\nनमस्ते = namastey");
    expect(displayText("ગુજરાત", "casual")).toBe("Gujju land");
    expect(displayText("नमस्ते!", "roman")).toBe("namastey!");
    expect(displayWord({ text: "ગુજરાત", roman: "GUJARAT" }, "casual")).toBe("GUJARAT");
    expect(displayWord({ text: "ગુજરાત", roman: "GUJARAT" }, "native")).toBe("ગુજરાત");
  });
});
