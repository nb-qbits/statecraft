import { CstParser } from "chevrotain";
import {
  Within, AtLeast, NoLongerThan, NoLaterThan, NotLaterThan, OnOrBefore, BecomesEffective,
  Every, Each, After, Of, From, The, This, In, Any, On, By, Before, First,
  EffectiveDate, Enactment, Passage,
  Calendar, Business, Working, Workday,
  Quarterly, Annual, Thereafter,
  Days, Hours, Years, Month, HavePassed,
  EvenNumbered, OddNumbered, RegularSession,
  Act, Chapter, Section,
  NumberWord, NumberLiteral, Comma,
  allTokens,
} from "./lexer.js";

export class TemporalParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  temporalExpression = this.RULE("temporalExpression", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.bareIntervalExpression) },
      { ALT: () => this.SUBRULE(this.anchoredRecurrence) },
      { ALT: () => this.SUBRULE(this.eventAnchoredRecurrence) },
      { ALT: () => this.SUBRULE(this.recurrenceExpression) },
      { ALT: () => this.SUBRULE(this.invertedDuration) },
      { ALT: () => this.SUBRULE(this.relativeDuration) },
      { ALT: () => this.SUBRULE(this.deadlineExpression) },
      { ALT: () => this.SUBRULE(this.effectiveOnExpression) },
      { ALT: () => this.SUBRULE(this.fixedDate) },
    ]);
  });

  // "quarterly", "annually", "annual"
  bareIntervalExpression = this.RULE("bareIntervalExpression", () => {
    this.OR([
      { ALT: () => this.CONSUME(Quarterly) },
      { ALT: () => this.CONSUME(Annual) },
    ]);
  });

  // "each December 15 [in even-numbered years] [thereafter]"
  anchoredRecurrence = this.RULE("anchoredRecurrence", () => {
    this.CONSUME(Each);
    this.CONSUME(Month);
    this.CONSUME(NumberLiteral, { LABEL: "day" });
    this.OPTION(() => this.SUBRULE(this.parityClause));
    this.OPTION2(() => this.CONSUME(Thereafter));
  });

  // "in [any] even-numbered|odd-numbered [year[s]]"
  parityClause = this.RULE("parityClause", () => {
    this.CONSUME(In);
    this.OPTION(() => this.CONSUME(Any));
    this.OR([
      { ALT: () => this.CONSUME(EvenNumbered) },
      { ALT: () => this.CONSUME(OddNumbered) },
    ]);
    this.OPTION2(() => this.CONSUME(Years));
  });

  // standalone "the first day of each regular session"
  eventAnchoredRecurrence = this.RULE("eventAnchoredRecurrence", () => {
    this.OPTION(() => this.CONSUME(The));
    this.CONSUME(First);
    this.CONSUME(Days);
    this.CONSUME(Of);
    this.CONSUME(Each);
    this.CONSUME(RegularSession);
  });

  // "every N [calendar|business|working] days/hours" OR "every N years [thereafter]"
  recurrenceExpression = this.RULE("recurrenceExpression", () => {
    this.CONSUME(Every);
    this.SUBRULE(this.quantity);
    this.OR([
      { ALT: () => {
        this.OPTION(() => this.SUBRULE(this.dayKind));
        this.SUBRULE(this.timeUnit);
        this.OPTION2(() => this.SUBRULE(this.referenceClause));
        this.OPTION3(() => this.SUBRULE(this.trailingScope));
      }},
      { ALT: () => {
        this.CONSUME(Years);
        this.OPTION4(() => this.CONSUME(Thereafter));
      }},
    ]);
  });

  // "before seven days have passed"
  invertedDuration = this.RULE("invertedDuration", () => {
    this.CONSUME(Before);
    this.SUBRULE(this.quantity);
    this.OPTION(() => this.SUBRULE(this.dayKind));
    this.SUBRULE(this.timeUnit);
    this.CONSUME(HavePassed);
  });

  fixedDate = this.RULE("fixedDate", () => {
    this.CONSUME(Month);
    this.CONSUME(NumberLiteral, { LABEL: "day" });
    this.CONSUME(Comma);
    this.CONSUME2(NumberLiteral, { LABEL: "year" });
  });

  fixedDateOptionalYear = this.RULE("fixedDateOptionalYear", () => {
    this.CONSUME(Month);
    this.CONSUME(NumberLiteral, { LABEL: "day" });
    this.OPTION(() => {
      this.CONSUME(Comma);
      this.CONSUME2(NumberLiteral, { LABEL: "year" });
    });
  });

  // "by|no later than|not later than|on or before" + (date [parity] | event anchor | relative duration)
  deadlineExpression = this.RULE("deadlineExpression", () => {
    this.OR1([
      { ALT: () => this.CONSUME(By) },
      { ALT: () => this.CONSUME(NoLaterThan) },
      { ALT: () => this.CONSUME(NotLaterThan) },
      { ALT: () => this.CONSUME(OnOrBefore) },
    ]);
    this.OR2([
      { ALT: () => {
        this.SUBRULE(this.fixedDateOptionalYear);
        this.OPTION(() => {
          this.OR3([
            { ALT: () => this.SUBRULE(this.parityClause) },
            { ALT: () => this.SUBRULE(this.ofEachYearClause) },
          ]);
        });
      }},
      { ALT: () => {
        this.SUBRULE(this.deadlineEventAnchor);
      }},
      { ALT: () => {
        this.SUBRULE(this.quantity);
        this.OPTION2(() => this.SUBRULE(this.dayKind));
        this.SUBRULE(this.timeUnit);
        this.OPTION3(() => this.SUBRULE(this.referenceClause));
      }},
    ]);
  });

  // "of each [calendar] year"
  ofEachYearClause = this.RULE("ofEachYearClause", () => {
    this.CONSUME(Of);
    this.CONSUME(Each);
    this.OPTION(() => this.CONSUME(Calendar));
    this.CONSUME(Years);
  });

  // event anchor within deadline: "the first day of each regular session"
  deadlineEventAnchor = this.RULE("deadlineEventAnchor", () => {
    this.OPTION(() => this.CONSUME(The));
    this.CONSUME(First);
    this.CONSUME(Days);
    this.CONSUME(Of);
    this.CONSUME(Each);
    this.CONSUME(RegularSession);
  });

  effectiveOnExpression = this.RULE("effectiveOnExpression", () => {
    this.CONSUME(BecomesEffective);
    this.CONSUME(On);
    this.SUBRULE(this.fixedDate);
  });

  relativeDuration = this.RULE("relativeDuration", () => {
    this.OR([
      { ALT: () => this.CONSUME(Within) },
      { ALT: () => this.CONSUME(NoLongerThan) },
      { ALT: () => this.CONSUME(AtLeast) },
    ]);
    this.SUBRULE(this.quantity);
    this.OR2([
      { ALT: () => {
        this.OPTION(() => this.SUBRULE(this.dayKind));
        this.SUBRULE(this.timeUnit);
      }},
      { ALT: () => this.CONSUME(Workday) },
    ]);
    this.OPTION2(() => this.SUBRULE(this.referenceClause));
  });

  quantity = this.RULE("quantity", () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(NumberWord) },
    ]);
  });

  dayKind = this.RULE("dayKind", () => {
    this.OR([
      { ALT: () => this.CONSUME(Calendar) },
      { ALT: () => this.CONSUME(Business) },
      { ALT: () => this.CONSUME(Working) },
    ]);
  });

  timeUnit = this.RULE("timeUnit", () => {
    this.OR([
      { ALT: () => this.CONSUME(Days) },
      { ALT: () => this.CONSUME(Hours) },
    ]);
  });

  referenceClause = this.RULE("referenceClause", () => {
    this.SUBRULE(this.preposition);
    this.OPTION(() => this.CONSUME(The));
    this.SUBRULE(this.referenceEvent);
    this.OPTION2(() => this.SUBRULE(this.trailingScope));
  });

  preposition = this.RULE("preposition", () => {
    this.OR([
      { ALT: () => this.CONSUME(After) },
      { ALT: () => this.CONSUME(Of) },
      { ALT: () => this.CONSUME(From) },
    ]);
  });

  referenceEvent = this.RULE("referenceEvent", () => {
    this.OR([
      { ALT: () => this.CONSUME(EffectiveDate) },
      { ALT: () => this.CONSUME(Enactment) },
      { ALT: () => this.CONSUME(Passage) },
    ]);
  });

  trailingScope = this.RULE("trailingScope", () => {
    this.CONSUME(Of);
    this.CONSUME(This);
    this.OR([
      { ALT: () => this.CONSUME(Act) },
      { ALT: () => this.CONSUME(Chapter) },
      { ALT: () => this.CONSUME(Section) },
    ]);
  });
}

export const parserInstance = new TemporalParser();
