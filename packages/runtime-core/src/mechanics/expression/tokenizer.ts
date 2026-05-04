/**
 * Tokenizer for mechanics expressions.
 *
 * Produces position-aware tokens so parser and validator errors can point to
 * the exact character that made an authored formula invalid.
 */

export type TokenKind =
  | "number"
  | "string"
  | "identifier"
  | "boolean"
  | "operator"
  | "punctuation"
  | "eof";

export interface ExpressionToken {
  kind: TokenKind;
  value: string;
  position: number;
}

export class ExpressionSyntaxError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly position: number
  ) {
    super(`${message} at character ${position + 1}`);
    this.name = "ExpressionSyntaxError";
  }
}

const twoCharacterOperators = new Set(["==", "!=", "<=", ">=", "&&", "||"]);

const oneCharacterOperators = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "<",
  ">",
  "?"
]);

const punctuation = new Set(["(", ")", ",", ".", ":"]);

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_-]/.test(char);
}

export function tokenizeExpression(source: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const char = source[cursor]!;
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    const two = source.slice(cursor, cursor + 2);
    if (twoCharacterOperators.has(two)) {
      tokens.push({ kind: "operator", value: two, position: cursor });
      cursor += 2;
      continue;
    }

    if (oneCharacterOperators.has(char)) {
      tokens.push({ kind: "operator", value: char, position: cursor });
      cursor += 1;
      continue;
    }

    if (punctuation.has(char)) {
      tokens.push({ kind: "punctuation", value: char, position: cursor });
      cursor += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = cursor;
      cursor += 1;
      let value = "";
      while (cursor < source.length && source[cursor] !== quote) {
        if (source[cursor] === "\\") {
          const escaped = source[cursor + 1];
          if (!escaped) {
            throw new ExpressionSyntaxError(
              "Unterminated string escape",
              source,
              cursor
            );
          }
          value += escaped;
          cursor += 2;
          continue;
        }
        value += source[cursor]!;
        cursor += 1;
      }
      if (source[cursor] !== quote) {
        throw new ExpressionSyntaxError("Unterminated string", source, start);
      }
      cursor += 1;
      tokens.push({ kind: "string", value, position: start });
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(source[cursor + 1] ?? ""))) {
      const start = cursor;
      let sawDot = false;
      while (cursor < source.length) {
        const next = source[cursor]!;
        if (next === ".") {
          if (sawDot) break;
          sawDot = true;
          cursor += 1;
          continue;
        }
        if (!isDigit(next)) break;
        cursor += 1;
      }
      tokens.push({
        kind: "number",
        value: source.slice(start, cursor),
        position: start
      });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < source.length && isIdentifierPart(source[cursor]!)) {
        cursor += 1;
      }
      const value = source.slice(start, cursor);
      tokens.push({
        kind: value === "true" || value === "false" ? "boolean" : "identifier",
        value,
        position: start
      });
      continue;
    }

    throw new ExpressionSyntaxError(
      `Unexpected character "${char}"`,
      source,
      cursor
    );
  }

  tokens.push({ kind: "eof", value: "", position: source.length });
  return tokens;
}
