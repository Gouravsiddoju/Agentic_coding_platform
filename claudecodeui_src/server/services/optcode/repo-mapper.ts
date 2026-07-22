import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'dist-server']);
const MAX_FILES_TO_PROCESS = 1000; // Safety limit

/**
 * Parses a TypeScript/JavaScript file and extracts classes, methods, and functions.
 */
function extractFileSignatures(filePath: string): string {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      code,
      ts.ScriptTarget.Latest,
      true
    );

    const signatures: string[] = [];

    function visit(node: ts.Node) {
      // Extract classes and their methods
      if (ts.isClassDeclaration(node) && node.name) {
        signatures.push(`  class ${node.name.text}`);
        
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            signatures.push(`    ${methodName}()`);
          }
        });
      }

      // Extract standalone functions
      if (ts.isFunctionDeclaration(node) && node.name) {
        signatures.push(`  function ${node.name.text}()`);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (signatures.length > 0) {
      return signatures.join('\n');
    }
  } catch (e) {
    // Silently ignore parsing errors
  }
  return '';
}

/**
 * Recursively find all source files in a directory.
 */
function findSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (fileList.length >= MAX_FILES_TO_PROCESS) return fileList;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (fileList.length >= MAX_FILES_TO_PROCESS) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          findSourceFiles(fullPath, fileList);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Ignore known binary/asset extensions to prevent cluttering the repo map, but allow ALL programming languages
        const ignoredExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp4', '.webm', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.woff', '.woff2', '.eot', '.ttf', '.otf']);
        if (!ignoredExts.has(ext) && !entry.name.endsWith('.d.ts')) {
          fileList.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore permissions/access errors
  }
  return fileList;
}

/**
 * Generates a highly compressed structural map of the repository.
 * Format:
 * src/file.ts
 *   class MyClass
 *     myMethod()
 *   function myFunc()
 */
export function generateRawRepoMap(targetDir: string): { path: string, signatures: string }[] {
  const sourceFiles = findSourceFiles(targetDir);
  const result: { path: string, signatures: string }[] = [];

  for (const file of sourceFiles) {
    const relativePath = path.relative(targetDir, file).replace(/\\/g, '/');
    const fileSigs = extractFileSignatures(file);
    if (fileSigs) {
      result.push({ path: relativePath, signatures: fileSigs });
    } else {
      result.push({ path: relativePath, signatures: '  (File exists)' });
    }
  }
  return result;
}

export function generateRepoMap(targetDir: string): string {
  const rawMap = generateRawRepoMap(targetDir);
  const mapLines: string[] = [];
  
  for (const entry of rawMap) {
    mapLines.push(entry.path);
    mapLines.push(entry.signatures);
  }

  const map = mapLines.join('\n');
  return map ? map : '(No parsable source files found in the repository)';
}
