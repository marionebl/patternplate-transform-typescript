import * as md5 from 'md5';
import * as path from 'path';
import * as ts from 'typescript';
import { mapJsx, mapTarget, mapModule } from './options';
import { PatterplateFile } from './types';

export interface TranspileOptions {
  compilerOptions?: ts.CompilerOptions;
  fileName?: string;
  reportDiagnostics?: boolean;
  moduleName?: string;
  renamedDependencies?: ts.MapLike<string>;
}

export interface TranspileOutput {
  status: number;
  outputText: string;
  declarationText?: string;
  diagnostics?: ts.Diagnostic[];
  sourceMapText?: string;
}

interface CacheEntry {
  status: number;
  outputText: string;
  declarationText: string;
  sourceMapText: string;
}
const cache: {[hash: string]: CacheEntry} = {};

// tslint:disable cyclomatic-complexity
export function transpileModule(input: string, transpileOptions: TranspileOptions,
    map: {[path: string]: PatterplateFile}, patternRoot: string): TranspileOutput {
  const hash = md5(input);
  if (hash in cache) {
    const { status, outputText, declarationText, sourceMapText } = cache[hash];
    return {
      status,
      outputText,
      declarationText,
      diagnostics: undefined,
      sourceMapText
    };
  }

  const options: ts.CompilerOptions = transpileOptions.compilerOptions || ts.getDefaultCompilerOptions();

  if (options.jsx) {
    options.jsx = mapJsx(options.jsx);
  }
  if (options.target) {
    options.target = mapTarget(options.target);
  }

  if (options.module) {
    options.module = mapModule(options.module);
  }

  // if jsx is specified then treat file as .tsx
  const inputFileName = transpileOptions.fileName || (options.jsx ? 'module.tsx' : 'module.ts');
  const sourceFile = ts.createSourceFile(inputFileName, input, options.target || ts.ScriptTarget.ES5);
  if (transpileOptions.moduleName) {
    sourceFile.moduleName = transpileOptions.moduleName;
  }

  // output
  let outputText = '';
  let declarationText = '';
  let sourceMapText = '';

  // create a compilerHost object to allow the compiler to read and write files
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      if (fileName === inputFileName) {
        return sourceFile;
      }
      try {
        return ts.createSourceFile(fileName, ts.sys.readFile(fileName), options.target || ts.ScriptTarget.ES5);
      } catch (e) {
        console.error('failed to read source-file', fileName);
        return undefined!;
      }
    },
    writeFile: (name, text) => {
      if (name.endsWith('.map')) {
        sourceMapText = text;
      } else if (name.endsWith('.d.ts')) {
        declarationText = text;
      } else {
        outputText = text;
      }
    },
    getDefaultLibFileName: () => ts.getDefaultLibFilePath(options),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
    fileExists: (fileName): boolean => ts.sys.fileExists(fileName),
    readFile: path => ts.sys.readFile(path),
    directoryExists: path => ts.sys.directoryExists(path),
    getDirectories: () => [],
    resolveModuleNames(moduleNames: string[], containingFile: string): (ts.ResolvedModule)[] {
      return moduleNames.map(moduleName => {
        // try patternplate demo Pattern dependency
        if (moduleName === 'Pattern' && containingFile.endsWith('demo.tsx')) {
          return { resolvedFileName: containingFile.replace('demo.tsx', 'index.tsx') };
        }

        const patternManifest = map[containingFile].pattern.manifest;
        if (patternManifest.patterns && moduleName in patternManifest.patterns) {
          const resolvedFileName = path.join(patternRoot, patternManifest.patterns[moduleName], 'index.tsx');
          return { resolvedFileName };
        }

        // try to use standard resolution
        const result = ts.resolveModuleName(moduleName, containingFile, options,
          { fileExists: ts.sys.fileExists, readFile: ts.sys.readFile });
        if (result && result.resolvedModule) {
          return result.resolvedModule;
        }

        // note: as any is a quirk here, since the CompilerHost interface does not allow strict null checks
        return undefined as any;
      });
    }
  };

  const program = ts.createProgram([inputFileName], options, compilerHost);

  const result = program.emit();
  const allDiagnostics =
    ts.getPreEmitDiagnostics(program)
    .concat(
      result.diagnostics,
      getDeclarationDiagnostics(program),
      program.getGlobalDiagnostics(),
      program.getOptionsDiagnostics(),
      program.getSemanticDiagnostics(),
      program.getSyntacticDiagnostics()
    );
  allDiagnostics.forEach(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      throw new Error(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
      throw new Error(message);
    }
  });
  const exitCode = result.emitSkipped ? 1 : 0;

  cache[hash] = {
    status: exitCode,
    outputText,
    declarationText,
    sourceMapText
  };
  return {
    status: exitCode,
    outputText,
    declarationText,
    diagnostics: allDiagnostics,
    sourceMapText
  };
}

function getDeclarationDiagnostics(program: ts.Program): ts.Diagnostic[] {
  try {
    return program.getDeclarationDiagnostics();
  } catch (e) {
    return [];
  }
}
