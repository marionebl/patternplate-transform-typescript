import * as ts from 'typescript';

export interface PatterplateFile {
  buffer: Buffer | string;
  name: string;
  basename: string;
  ext: string;
  format: string;
  fs: any;
  path: string;
  pattern: {
    id: string;
    base: string;
    path: string;
  };
  meta: any;
  dependencies: { [name: string]: PatterplateFile };
  in: string;
  out: string;
}

export interface PatternplateConfiguration {
  opts: ts.CompilerOptions;
}

export interface Application {
  resources?: any;
}

export interface TypeScriptTransform {
  (file: PatterplateFile, unused: any, configuration: PatternplateConfiguration):
    Promise<PatterplateFile>;
}
