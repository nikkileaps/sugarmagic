/**
 * Mechanics expression AST.
 *
 * The expression language is intentionally small and side-effect free. Castable
 * sequencing lives in structured ops; expressions only calculate values.
 */

export type ExpressionAst =
  | LiteralExpression
  | MemberExpression
  | UnaryExpression
  | BinaryExpression
  | TernaryExpression
  | CallExpression;

export interface LiteralExpression {
  kind: "literal";
  value: string | number | boolean;
}

export interface MemberExpression {
  kind: "member";
  path: string[];
}

export interface UnaryExpression {
  kind: "unary";
  operator: "!" | "-";
  argument: ExpressionAst;
}

export interface BinaryExpression {
  kind: "binary";
  operator:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "=="
    | "!="
    | "<"
    | ">"
    | "<="
    | ">="
    | "&&"
    | "||";
  left: ExpressionAst;
  right: ExpressionAst;
}

export interface TernaryExpression {
  kind: "ternary";
  condition: ExpressionAst;
  then: ExpressionAst;
  else: ExpressionAst;
}

export interface CallExpression {
  kind: "call";
  callee: string;
  args: ExpressionAst[];
}
