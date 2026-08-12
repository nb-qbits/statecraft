import { createToken, Lexer } from "chevrotain";

export const Within = createToken({ name: "Within", pattern: /within/i });
export const NoLongerThan = createToken({ name: "NoLongerThan", pattern: /no longer than/i });
export const NoLaterThan = createToken({ name: "NoLaterThan", pattern: /no later than/i });
export const OnOrBefore = createToken({ name: "OnOrBefore", pattern: /on or before/i });
export const BecomesEffective = createToken({ name: "BecomesEffective", pattern: /becomes? effective/i });
export const Every = createToken({ name: "Every", pattern: /every/i });
export const After = createToken({ name: "After", pattern: /after/i });
export const Of = createToken({ name: "Of", pattern: /of/i });
export const From = createToken({ name: "From", pattern: /from/i });
export const The = createToken({ name: "The", pattern: /the/i });
export const This = createToken({ name: "This", pattern: /this/i });

export const EffectiveDate = createToken({ name: "EffectiveDate", pattern: /effective date/i });
export const Enactment = createToken({ name: "Enactment", pattern: /enactment/i });
export const Passage = createToken({ name: "Passage", pattern: /passage/i });

export const Calendar = createToken({ name: "Calendar", pattern: /calendar/i });
export const Business = createToken({ name: "Business", pattern: /business/i });
export const Working = createToken({ name: "Working", pattern: /working/i });

export const Days = createToken({ name: "Days", pattern: /days?/i });
export const Hours = createToken({ name: "Hours", pattern: /hours?/i });

export const Month = createToken({
  name: "Month",
  pattern: /January|February|March|April|May|June|July|August|September|October|November|December/i,
});

export const Act = createToken({ name: "Act", pattern: /act/i });
export const Chapter = createToken({ name: "Chapter", pattern: /chapter/i });
export const Section = createToken({ name: "Section", pattern: /section/i });
export const By = createToken({ name: "By", pattern: /by/i });
export const On = createToken({ name: "On", pattern: /on/i });

export const NumberWord = createToken({
  name: "NumberWord",
  pattern: /one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety/i,
});

export const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: /\d+/,
});

export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

export const allTokens = [
  WhiteSpace,
  NoLongerThan,
  NoLaterThan,
  OnOrBefore,
  BecomesEffective,
  Within,
  Every,
  EffectiveDate,
  Enactment,
  Passage,
  After,
  From,
  Calendar,
  Business,
  Working,
  Days,
  Hours,
  Month,
  Of,
  The,
  This,
  Act,
  Chapter,
  Section,
  NumberWord,
  NumberLiteral,
  By,
  On,
  Comma,
];

export const TemporalLexer = new Lexer(allTokens);
