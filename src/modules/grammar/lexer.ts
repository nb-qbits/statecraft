import { createToken, Lexer } from "chevrotain";

// Multi-word tokens first (longest match wins)
export const EvenNumbered = createToken({ name: "EvenNumbered", pattern: /even[- ]numbered/i });
export const OddNumbered = createToken({ name: "OddNumbered", pattern: /odd[- ]numbered/i });
export const RegularSession = createToken({ name: "RegularSession", pattern: /regular session/i });
export const Within = createToken({ name: "Within", pattern: /within/i });
export const AtLeast = createToken({ name: "AtLeast", pattern: /at least/i });
export const NoLongerThan = createToken({ name: "NoLongerThan", pattern: /no longer than/i });
export const NoLaterThan = createToken({ name: "NoLaterThan", pattern: /no later than/i });
export const OnOrBefore = createToken({ name: "OnOrBefore", pattern: /on or before/i });
export const BecomesEffective = createToken({ name: "BecomesEffective", pattern: /becomes? effective/i });
export const Every = createToken({ name: "Every", pattern: /every/i });
export const Each = createToken({ name: "Each", pattern: /each/i });
export const After = createToken({ name: "After", pattern: /after/i });
export const Of = createToken({ name: "Of", pattern: /of/i });
export const From = createToken({ name: "From", pattern: /from/i });
export const The = createToken({ name: "The", pattern: /the/i });
export const This = createToken({ name: "This", pattern: /this/i });
export const In = createToken({ name: "In", pattern: /in/i });
export const Any = createToken({ name: "Any", pattern: /any/i });

export const EffectiveDate = createToken({ name: "EffectiveDate", pattern: /effective date/i });
export const Enactment = createToken({ name: "Enactment", pattern: /enactment/i });
export const Passage = createToken({ name: "Passage", pattern: /passage/i });

export const Calendar = createToken({ name: "Calendar", pattern: /calendar/i });
export const Business = createToken({ name: "Business", pattern: /business/i });
export const Working = createToken({ name: "Working", pattern: /working/i });

export const Quarterly = createToken({ name: "Quarterly", pattern: /quarterly/i });
export const Annual = createToken({ name: "Annual", pattern: /annual(?:ly)?/i });

export const Days = createToken({ name: "Days", pattern: /days?/i });
export const Hours = createToken({ name: "Hours", pattern: /hours?/i });
export const Years = createToken({ name: "Years", pattern: /years?/i });

export const First = createToken({ name: "First", pattern: /first/i });
export const Thereafter = createToken({ name: "Thereafter", pattern: /thereafter/i });

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
  EvenNumbered,
  OddNumbered,
  RegularSession,
  AtLeast,
  NoLongerThan,
  NoLaterThan,
  OnOrBefore,
  BecomesEffective,
  EffectiveDate,
  Within,
  Quarterly,
  Thereafter,
  Every,
  Each,
  Enactment,
  Passage,
  After,
  Annual,
  From,
  Calendar,
  Business,
  Working,
  First,
  Days,
  Hours,
  Years,
  Month,
  Of,
  The,
  This,
  In,
  Any,
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
