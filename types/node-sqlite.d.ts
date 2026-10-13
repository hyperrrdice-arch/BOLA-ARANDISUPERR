declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    sourceSQL: string;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
