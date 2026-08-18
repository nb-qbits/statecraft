import type { CstNode, IToken } from "chevrotain";
import { parserInstance } from "./parser.js";
import type {
  TemporalExpression,
  DayKind,
  TimeUnit,
  ReferenceEvent,
  YearParity,
} from "./types.js";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const WORD_TO_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor();

class TemporalVisitor extends BaseCstVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  temporalExpression(ctx: Record<string, CstNode[]>): TemporalExpression {
    if (ctx["bareIntervalExpression"]) {
      return this.visit(ctx["bareIntervalExpression"]!) as TemporalExpression;
    }
    if (ctx["anchoredRecurrence"]) {
      return this.visit(ctx["anchoredRecurrence"]!) as TemporalExpression;
    }
    if (ctx["eventAnchoredRecurrence"]) {
      return this.visit(ctx["eventAnchoredRecurrence"]!) as TemporalExpression;
    }
    if (ctx["recurrenceExpression"]) {
      return this.visit(ctx["recurrenceExpression"]!) as TemporalExpression;
    }
    if (ctx["invertedDuration"]) {
      return this.visit(ctx["invertedDuration"]!) as TemporalExpression;
    }
    if (ctx["relativeDuration"]) {
      return this.visit(ctx["relativeDuration"]!) as TemporalExpression;
    }
    if (ctx["deadlineExpression"]) {
      return this.visit(ctx["deadlineExpression"]!) as TemporalExpression;
    }
    if (ctx["effectiveOnExpression"]) {
      return this.visit(ctx["effectiveOnExpression"]!) as TemporalExpression;
    }
    return this.visit(ctx["fixedDate"]!) as TemporalExpression;
  }

  bareIntervalExpression(ctx: Record<string, IToken[]>): TemporalExpression {
    if (ctx["Quarterly"]) {
      return {
        kind: "recurrence", frequency: "quarterly", interval: 1,
        byMonth: null, byMonthDay: null, yearParity: null,
        anchorEvent: null, boundKind: "on", dayKind: null,
      };
    }
    return {
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    };
  }

  anchoredRecurrence(ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    const monthStr = (ctx["Month"] as IToken[])[0]!.image.toLowerCase();
    const day = parseInt((ctx["day"] as IToken[])[0]!.image, 10);
    const parity = ctx["parityClause"]
      ? (this.visit(ctx["parityClause"] as CstNode[]) as YearParity)
      : null;

    return {
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: MONTH_MAP[monthStr]!, byMonthDay: day,
      yearParity: parity, anchorEvent: null, boundKind: "on", dayKind: null,
    };
  }

  parityClause(ctx: Record<string, IToken[]>): YearParity {
    return ctx["EvenNumbered"] ? "even" : "odd";
  }

  eventAnchoredRecurrence(_ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    return {
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: "regular_session", boundKind: "on", dayKind: null,
    };
  }

  invertedDuration(ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    const quantity = this.visit(ctx["quantity"] as CstNode[]) as number;
    const dayKindVal = ctx["dayKind"]
      ? (this.visit(ctx["dayKind"] as CstNode[]) as DayKind)
      : null;
    const unit = this.visit(ctx["timeUnit"] as CstNode[]) as TimeUnit;
    return {
      kind: "relative_duration",
      quantity,
      unit,
      dayKind: dayKindVal,
      preposition: null,
      referenceEvent: null,
      referenceEventText: null,
      boundKind: "no_longer_than",
    };
  }

  recurrenceExpression(ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    const quantity = this.visit(ctx["quantity"] as CstNode[]) as number;

    if (ctx["Years"]) {
      return {
        kind: "recurrence", frequency: "yearly", interval: quantity,
        byMonth: null, byMonthDay: null, yearParity: null,
        anchorEvent: null, boundKind: "on", dayKind: null,
      };
    }

    const dayKindVal = ctx["dayKind"]
      ? (this.visit(ctx["dayKind"] as CstNode[]) as DayKind)
      : null;
    const unit = this.visit(ctx["timeUnit"] as CstNode[]) as TimeUnit;

    let preposition: string | null = null;
    let referenceEvent: ReferenceEvent | null = null;
    if (ctx["referenceClause"]) {
      const ref = this.visit(ctx["referenceClause"] as CstNode[]) as {
        preposition: string;
        referenceEvent: ReferenceEvent;
      };
      preposition = ref.preposition;
      referenceEvent = ref.referenceEvent;
    }

    const boundKind = ctx["Within"] ? "within" : ctx["AtLeast"] ? "at_least" : "no_longer_than";

    return {
      kind: "relative_duration",
      quantity,
      unit,
      dayKind: dayKindVal,
      preposition,
      referenceEvent,
      referenceEventText: null,
      boundKind,
    };
  }

  fixedDate(ctx: Record<string, IToken[]>): TemporalExpression {
    const monthStr = ctx["Month"]![0]!.image.toLowerCase();
    const day = parseInt(ctx["day"]![0]!.image, 10);
    const year = parseInt(ctx["year"]![0]!.image, 10);

    return { kind: "fixed_date", month: MONTH_MAP[monthStr]!, day, year };
  }

  fixedDateOptionalYear(ctx: Record<string, IToken[]>): TemporalExpression {
    const monthStr = ctx["Month"]![0]!.image.toLowerCase();
    const day = parseInt(ctx["day"]![0]!.image, 10);
    const year = ctx["year"] ? parseInt(ctx["year"]![0]!.image, 10) : null;

    return { kind: "fixed_date", month: MONTH_MAP[monthStr]!, day, year };
  }

  deadlineExpression(ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    if (ctx["deadlineEventAnchor"]) {
      return {
        kind: "recurrence", frequency: "yearly", interval: 1,
        byMonth: null, byMonthDay: null, yearParity: null,
        anchorEvent: "regular_session", boundKind: "no_later_than", dayKind: null,
      };
    }

    if (ctx["quantity"]) {
      const quantity = this.visit(ctx["quantity"] as CstNode[]) as number;
      const dayKindVal = ctx["dayKind"]
        ? (this.visit(ctx["dayKind"] as CstNode[]) as DayKind)
        : null;
      const unit = this.visit(ctx["timeUnit"] as CstNode[]) as TimeUnit;

      let preposition: string | null = null;
      let referenceEvent: ReferenceEvent | null = null;
      if (ctx["referenceClause"]) {
        const ref = this.visit(ctx["referenceClause"] as CstNode[]) as {
          preposition: string;
          referenceEvent: ReferenceEvent;
        };
        preposition = ref.preposition;
        referenceEvent = ref.referenceEvent;
      }

      return {
        kind: "relative_duration",
        quantity,
        unit,
        dayKind: dayKindVal,
        preposition,
        referenceEvent,
        referenceEventText: null,
        boundKind: "no_longer_than",
      };
    }

    const dateExpr = this.visit(ctx["fixedDateOptionalYear"] as CstNode[]) as TemporalExpression;

    if (ctx["parityClause"]) {
      const parity = this.visit(ctx["parityClause"] as CstNode[]) as YearParity;
      if (dateExpr.kind === "fixed_date") {
        return {
          kind: "recurrence", frequency: "yearly", interval: 1,
          byMonth: dateExpr.month, byMonthDay: dateExpr.day,
          yearParity: parity, anchorEvent: null,
          boundKind: "no_later_than", dayKind: null,
        };
      }
    }

    if (ctx["ofEachYearClause"] && dateExpr.kind === "fixed_date") {
      return {
        kind: "recurrence", frequency: "yearly", interval: 1,
        byMonth: dateExpr.month, byMonthDay: dateExpr.day,
        yearParity: null, anchorEvent: null,
        boundKind: "no_later_than", dayKind: null,
      };
    }

    return dateExpr;
  }

  deadlineEventAnchor(): void {
    // semantic value is produced by deadlineExpression
  }

  ofEachYearClause(): void {
    // semantic value is produced by deadlineExpression
  }

  effectiveOnExpression(ctx: Record<string, CstNode[]>): TemporalExpression {
    return this.visit(ctx["fixedDate"]!) as TemporalExpression;
  }

  relativeDuration(ctx: Record<string, CstNode[] | IToken[]>): TemporalExpression {
    const quantity = this.visit(ctx["quantity"] as CstNode[]) as number;

    let dayKindVal: DayKind | null = null;
    let unit: TimeUnit = "days";

    if (ctx["Workday"]) {
      dayKindVal = "working";
      unit = "days";
    } else {
      dayKindVal = ctx["dayKind"]
        ? (this.visit(ctx["dayKind"] as CstNode[]) as DayKind)
        : null;
      unit = this.visit(ctx["timeUnit"] as CstNode[]) as TimeUnit;
    }

    let preposition: string | null = null;
    let referenceEvent: ReferenceEvent | null = null;
    if (ctx["referenceClause"]) {
      const ref = this.visit(ctx["referenceClause"] as CstNode[]) as {
        preposition: string;
        referenceEvent: ReferenceEvent;
      };
      preposition = ref.preposition;
      referenceEvent = ref.referenceEvent;
    }

    const boundKind = ctx["Within"] ? "within" : ctx["AtLeast"] ? "at_least" : "no_longer_than";

    return {
      kind: "relative_duration",
      quantity,
      unit,
      dayKind: dayKindVal,
      preposition,
      referenceEvent,
      referenceEventText: null,
      boundKind,
    };
  }

  quantity(ctx: Record<string, IToken[]>): number {
    if (ctx["NumberLiteral"]) {
      return parseInt(ctx["NumberLiteral"]![0]!.image, 10);
    }
    return WORD_TO_NUMBER[ctx["NumberWord"]![0]!.image.toLowerCase()]!;
  }

  dayKind(ctx: Record<string, IToken[]>): DayKind {
    if (ctx["Calendar"]) return "calendar";
    if (ctx["Business"]) return "business";
    return "working";
  }

  timeUnit(ctx: Record<string, IToken[]>): TimeUnit {
    if (ctx["Days"]) return "days";
    return "hours";
  }

  referenceClause(ctx: Record<string, CstNode[]>): {
    preposition: string;
    referenceEvent: ReferenceEvent;
  } {
    const preposition = this.visit(ctx["preposition"]!) as string;
    const referenceEvent = this.visit(ctx["referenceEvent"]!) as ReferenceEvent;
    return { preposition, referenceEvent };
  }

  preposition(ctx: Record<string, IToken[]>): string {
    if (ctx["After"]) return "after";
    if (ctx["Of"]) return "of";
    return "from";
  }

  referenceEvent(ctx: Record<string, IToken[]>): ReferenceEvent {
    if (ctx["EffectiveDate"]) return "effective_date";
    if (ctx["Enactment"]) return "enactment";
    return "passage";
  }

  trailingScope(): void {
    // consumed by the parser to allow trailing text — no semantic value
  }
}

export const temporalVisitor = new TemporalVisitor();
