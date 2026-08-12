import { CstParser } from "chevrotain";
import {
  Within, NoLongerThan, NoLaterThan, OnOrBefore, BecomesEffective,
  Every, After, Of, From, The, This, On, By,
  EffectiveDate, Enactment, Passage,
  Calendar, Business, Working,
  Days, Hours, Month,
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
      { ALT: () => this.SUBRULE(this.recurrenceExpression) },
      { ALT: () => this.SUBRULE(this.relativeDuration) },
      { ALT: () => this.SUBRULE(this.deadlineExpression) },
      { ALT: () => this.SUBRULE(this.effectiveOnExpression) },
      { ALT: () => this.SUBRULE(this.fixedDate) },
    ]);
  });

  fixedDate = this.RULE("fixedDate", () => {
    this.CONSUME(Month);
    this.CONSUME(NumberLiteral, { LABEL: "day" });
    this.CONSUME(Comma);
    this.CONSUME2(NumberLiteral, { LABEL: "year" });
  });

  deadlineExpression = this.RULE("deadlineExpression", () => {
    this.OR([
      { ALT: () => this.CONSUME(By) },
      { ALT: () => this.CONSUME(NoLaterThan) },
      { ALT: () => this.CONSUME(OnOrBefore) },
    ]);
    this.SUBRULE(this.fixedDate);
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
    ]);
    this.SUBRULE(this.quantity);
    this.OPTION(() => this.SUBRULE(this.dayKind));
    this.SUBRULE(this.timeUnit);
    this.OPTION2(() => this.SUBRULE(this.referenceClause));
  });

  recurrenceExpression = this.RULE("recurrenceExpression", () => {
    this.CONSUME(Every);
    this.SUBRULE(this.quantity);
    this.OPTION(() => this.SUBRULE(this.dayKind));
    this.SUBRULE(this.timeUnit);
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
