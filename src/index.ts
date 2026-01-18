#!/usr/bin/env node

import { cac } from 'cac';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { Lexer } from './lexer.js';
import { Parser } from './parser/index.js';
import { IRGenerator } from './generator/ir_generator.js';
import { Stmt, AstPrinter, FunctionDeclaration, Parameter, TypeAnnotation, DeclareFunction, ClassDeclaration, StructDeclaration, PropertyDeclaration } from './ast.js';

const cli = cac('tsyuc');

cli
  .command('<file>', 'Compile a Yulang source file')
  .option('--output <path>', 'Output file path', { default: './a.out' })
  .option('--debug', 'Enable debug output (tokens, AST, IR)', { default: false })
  .option('--target <type>', 'Compilation target type: exec (executable), static-lib (static library), declare-file (declaration file), or asm (assembly file)', { default: 'exec' })
  .option('--no-std-lib', 'Do not link the standard library automatically', { default: false })
  .action(async (filePath, options) => {
    const inputFilePath = path.resolve(filePath);
    const outputFilePath = path.resolve(options.output);
    const outputDir = path.dirname(outputFilePath);
    const outputFileName = path.basename(outputFilePath);

    if (!fs.existsSync(inputFilePath)) {
      console.error(`Error: Input file not found: ${inputFilePath}`);
      process.exit(1);
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      console.log(`Compiling ${inputFilePath} to ${outputFilePath} (Target: ${options.target})`);

      // 1. Lexing
      const sourceCode = fs.readFileSync(inputFilePath, 'utf8');
      const lexer = new Lexer(sourceCode);
      const tokens = lexer.tokenize();
      if (options.debug) {
        console.log("\n--- Tokens ---");
        tokens.forEach(token => console.log(token.toString()));
      }

      // 2. Parsing
      const parser = new Parser(tokens, inputFilePath); // Pass inputFilePath
      const statements: Stmt[] = parser.parse();
      if (options.debug) {
        console.log("\n--- AST ---");
        const printer = new AstPrinter();
        statements.forEach(stmt => {
          if (stmt) {
            console.log(printer.print(stmt));
          }
        });
      }
      if (options.target === 'declare-file') {
        const printer = new AstPrinter(); // Re-use AstPrinter for declare file
        const declareFileContent = statements
          .filter(stmt => stmt instanceof FunctionDeclaration || stmt instanceof DeclareFunction || stmt instanceof ClassDeclaration || stmt instanceof StructDeclaration)
          .map(stmt => {
            if (stmt instanceof FunctionDeclaration) {
              const funcDecl = stmt as FunctionDeclaration;
              const params = funcDecl.parameters.map((p: Parameter) => {
                const typeStr = p.type ? `: ${printer.printType(p.type)}` : '';
                return `${p.name.lexeme}${typeStr}`;
              }).join(", ");
              const returnType = funcDecl.returnType ? `: ${printer.printType(funcDecl.returnType)}` : '';
              return `declare fun ${funcDecl.name.lexeme}(${params})${returnType};`;
            } else if (stmt instanceof DeclareFunction) {
              const declareFunc = stmt as DeclareFunction;
              const params = declareFunc.parameters.map((p: Parameter) => {
                const typeStr = p.type ? `: ${printer.printType(p.type)}` : '';
                return `${p.name.lexeme}${typeStr}`;
              }).join(", ");
              const returnType = declareFunc.returnType ? `: ${printer.printType(declareFunc.returnType)}` : '';
              return `declare fun ${declareFunc.name.lexeme}(${params})${returnType};`;
            } else if (stmt instanceof ClassDeclaration) { // Handle ClassDeclaration
              const classDecl = stmt as ClassDeclaration;
              let classContent = `declare class ${classDecl.name.lexeme} {\n`;
              classDecl.properties.forEach((prop: PropertyDeclaration) => {
                const propType = prop.type ? `: ${printer.printType(prop.type)}` : '';
                const visibility = prop.visibility.lexeme; // e.g., 'public'
                classContent += `    ${visibility} ${prop.name.lexeme}${propType};\n`;
              });

              classDecl.methods.forEach((method: FunctionDeclaration) => {
                const params = method.parameters.map((p: Parameter) => {
                  const typeStr = p.type ? `: ${printer.printType(p.type)}` : '';
                  return `${p.name.lexeme}${typeStr}`;
                }).join(", ");
                const returnType = method.returnType ? `: ${printer.printType(method.returnType)}` : '';
                // Class methods in declare files don't need 'declare fun'
                classContent += `    fun ${method.name.lexeme}(${params})${returnType};\n`;
              });

              classContent += `}`;
              return classContent;
            } else if (stmt instanceof StructDeclaration) { // NEW: Handle StructDeclaration
              const structDecl = stmt as StructDeclaration;
              let structContent = `declare struct ${structDecl.name.lexeme} {\n`;

              structDecl.properties.forEach((prop: PropertyDeclaration) => {
                const propType = prop.type ? `: ${printer.printType(prop.type)}` : '';
                // Struct properties in declare files don't have visibility
                structContent += `    ${prop.name.lexeme}${propType};\n`;
              });

              structContent += `}`;
              return structContent;
            }
            return ''; // Should not happen
          })
          .join('\n');

        fs.writeFileSync(outputFilePath, declareFileContent);
        console.log(`Successfully generated declaration file: ${outputFilePath}`);


      } else {

        // 3. IR Generation (only for exec or static-lib)

        const mangleStdLib = (options.target === 'exec'); // Mangle for exec, not for static-lib
        const irGenerator = new IRGenerator(parser, mangleStdLib, inputFilePath); const llvmIr = irGenerator.generate(statements);
        if (options.debug) {
          console.log("\n--- LLVM IR ---");
          console.log(llvmIr);
        }
        // Create temp files for compilation steps
        const tempDir = path.join(outputDir, '.tsyuc_build_temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const llPath = path.join(tempDir, `${outputFileName}.ll`);
        const objPath = path.join(tempDir, `${outputFileName}.o`);

        fs.writeFileSync(llPath, llvmIr);

        if (options.target === 'asm') {
          const asmPath = outputFilePath.endsWith('.s') ? outputFilePath : outputFilePath + '.s';
          console.log(`  [CMD] llc -filetype=asm -relocation-model=pic ${llPath} -o ${asmPath}`);
          execFileSync('llc', ['-filetype=asm', '-relocation-model=pic', llPath, '-o', asmPath], { stdio: 'inherit' });
        } else {
          // 4. Compile LLVM IR to object file
          console.log(`  [CMD] llc -filetype=obj -relocation-model=pic ${llPath} -o ${objPath}`);
          execFileSync('llc', ['-filetype=obj', '-relocation-model=pic', llPath, '-o', objPath], { stdio: 'inherit' });

          if (options.target === 'exec') {
            // 5. Link object file into an executable（仅引导+用户目标，不再预编译 std）
            console.log(`  [CMD] ld -o ${outputFilePath} dist/libs/standard/bootstrap.o ${objPath} -dynamic-linker /lib64/ld-linux-x86-64.so.2 -m elf_x86_64 --eh-frame-hdr -pie -z relro -z now`);
            execFileSync('ld', ['-o', outputFilePath, 'dist/libs/standard/bootstrap.o', objPath, '-dynamic-linker', '/lib64/ld-linux-x86-64.so.2', '-m', 'elf_x86_64', '--eh-frame-hdr', '-pie', '-z', 'relro', '-z', 'now'], { stdio: 'inherit' });
          } else if (options.target === 'static-lib') {
            // 5. Create static library (.a)
            console.log(`  [CMD] ar rc ${outputFilePath} ${objPath}`);
            execFileSync('ar', ['rc', outputFilePath, objPath], { stdio: 'inherit' });
          } else {
            throw new Error(`Unknown target type: ${options.target}`);
          }
        }

        // Clean up temp files
        fs.rmSync(tempDir, { recursive: true, force: true });

        console.log(`Successfully compiled to ${outputFilePath}`);
      }
    } catch (error: any) {
      console.error(`Compilation failed: ${error.message}`);
      if (error.stderr) {
        console.error(`Stderr: ${error.stderr.toString()}`);
      }
      process.exit(1);
    }
  });

cli.help();
cli.version('0.0.1');

cli.parse();
