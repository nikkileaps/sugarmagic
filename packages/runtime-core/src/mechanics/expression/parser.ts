/**
 * Recursive-descent parser for mechanics expressions.
 *
 * The grammar is intentionally conventional so authored formulas are easy for
 * humans and LLMs to read, and so validator errors stay localized.
 */

import type { ExpressionAst } from "./ast";
import {
  ExpressionSyntaxError,
  tokenizeExpression,
  type ExpressionToken
} from "./tokenizer";

export interface ParsedExpression {
  source: string;
  ast: ExpressionAst;
}

class Parser {
  private cursor = 0;
  private readonly tokens: ExpressionToken[];

  constructor(private readonly source: string) {
    this.tokens = tokenizeExpression(source);
  }

  parse(): ExpressionAst {
    const expression = this.parseTernary();
    this.expect("eof");
    return expression;
  }

  private parseTernary(): ExpressionAst {
    const condition = this.parseLogical();
    if (!this.matchValue("?")) {
      return condition;
    }
    const then = this.parseTernary();
    this.expectValue(":");
    const otherwise = this.parseTernary();
    return { kind: "ternary", condition, then, else: otherwise };
  }

  private parseLogical(): ExpressionAst {
    let expression = this.parseEquality();
    while (this.matchValue("&&") || this.matchValue("||")) {
      const operator = this.previous().value as "&&" | "||";
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseEquality()
      };
    }
    return expression;
  }

  private parseEquality(): ExpressionAst {
    let expression = this.parseComparison();
    while (this.matchValue("==") || this.matchValue("!=")) {
      const operator = this.previous().value as "==" | "!=";
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseComparison()
      };
    }
    return expression;
  }

  private parseComparison(): ExpressionAst {
    let expression = this.parseTerm();
    while (
      this.matchValue("<") ||
      this.matchValue(">") ||
      this.matchValue("<=") ||
      this.matchValue(">=")
    ) {
      const operator = this.previous().value as "<" | ">" | "<=" | ">=";
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseTerm()
      };
    }
    return expression;
  }

  private parseTerm(): ExpressionAst {
    let expression = this.parseFactor();
    while (this.matchValue("+") || this.matchValue("-")) {
      const operator = this.previous().value as "+" | "-";
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseFactor()
      };
    }
    return expression;
  }

  private parseFactor(): ExpressionAst {
    let expression = this.parseUnary();
    while (
      this.matchValue("*") ||
      this.matchValue("/") ||
      this.matchValue("%")
    ) {
      const operator = this.previous().value as "*" | "/" | "%";
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseUnary()
      };
    }
    return expression;
  }

  private parseUnary(): ExpressionAst {
    if (this.matchValue("!") || this.matchValue("-")) {
      const operator = this.previous().value as "!" | "-";
      return {
        kind: "unary",
        operator,
        argument: this.parseUnary()
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionAst {
    if (this.match("number")) {
      return { kind: "literal", value: Number(this.previous().value) };
    }
    if (this.match("string")) {
      return { kind: "literal", value: this.previous().value };
    }
    if (this.match("boolean")) {
      return { kind: "literal", value: this.previous().value === "true" };
    }
    if (this.matchValue("(")) {
      const expression = this.parseTernary();
      this.expectValue(")");
      return expression;
    }
    if (this.match("identifier")) {
      const identifier = this.previous().value;
      if (this.matchValue("(")) {
        return this.parseCall(identifier);
      }
      const path = [identifier];
      while (this.matchValue(".")) {
        const member = this.expect("identifier");
        path.push(member.value);
      }
      return { kind: "member", path };
    }
    const token = this.peek();
    throw new ExpressionSyntaxError(
      `Expected expression but found "${token.value || token.kind}"`,
      this.source,
      token.position
    );
  }

  private parseCall(callee: string): ExpressionAst {
    if (callee === "roll") {
      const diceTokens: ExpressionToken[] = [];
      while (!this.checkValue(")") && !this.check("eof")) {
        diceTokens.push(this.advance());
      }
      this.expectValue(")");
      return {
        kind: "call",
        callee,
        args: [
          {
            kind: "literal",
            value: diceTokens.map((token) => token.value).join("")
          }
        ]
      };
    }

    const args: ExpressionAst[] = [];
    if (!this.checkValue(")")) {
      do {
        args.push(this.parseTernary());
      } while (this.matchValue(","));
    }
    this.expectValue(")");
    return { kind: "call", callee, args };
  }

  private match(kind: ExpressionToken["kind"]): boolean {
    if (!this.check(kind)) return false;
    this.advance();
    return true;
  }

  private matchValue(value: string): boolean {
    if (!this.checkValue(value)) return false;
    this.advance();
    return true;
  }

  private expect(kind: ExpressionToken["kind"]): ExpressionToken {
    if (this.check(kind)) {
      return this.advance();
    }
    const token = this.peek();
    throw new ExpressionSyntaxError(
      `Expected ${kind} but found "${token.value || token.kind}"`,
      this.source,
      token.position
    );
  }

  private expectValue(value: string): ExpressionToken {
    if (this.checkValue(value)) {
      return this.advance();
    }
    const token = this.peek();
    throw new ExpressionSyntaxError(
      `Expected "${value}" but found "${token.value || token.kind}"`,
      this.source,
      token.position
    );
  }

  private check(kind: ExpressionToken["kind"]): boolean {
    return this.peek().kind === kind;
  }

  private checkValue(value: string): boolean {
    return this.peek().value === value;
  }

  private advance(): ExpressionToken {
    if (!this.check("eof")) this.cursor += 1;
    return this.previous();
  }

  private peek(): ExpressionToken {
    return this.tokens[this.cursor]!;
  }

  private previous(): ExpressionToken {
    return this.tokens[this.cursor - 1]!;
  }
}

export function parseExpression(source: string): ParsedExpression {
  return {
    source,
    ast: new Parser(source).parse()
  };
}
