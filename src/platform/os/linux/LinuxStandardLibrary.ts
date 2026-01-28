// src/platform/os/linux/LinuxStandardLibrary.ts
import * as path from 'path';
import type { IStandardLibrary } from '../../IStandardLibrary.js';

export class LinuxStandardLibrary implements IStandardLibrary {
    private projectRoot: string;
    private stdLibModuleBaseDir: string; // e.g., "dist/libs/std"
    private bootstrapPath: string;      // e.g., "dist/libs/standard/bootstrap.o"

    constructor(projectRoot: string, stdLibModuleBaseDir: string, bootstrapPath: string) {
        this.projectRoot = projectRoot;
        this.stdLibModuleBaseDir = stdLibModuleBaseDir;
        this.bootstrapPath = bootstrapPath;
    }

    getStdLibModulePath(moduleName: string): string {
        // moduleName could be "std/io", "std/mem" etc.
        // It needs to be resolved relative to stdLibModuleBaseDir
        const fullPath = path.join(this.projectRoot, this.stdLibModuleBaseDir, `${moduleName}.yu`);
        return fullPath;
    }

    getBootstrapPath(): string {
        return path.join(this.projectRoot, this.bootstrapPath);
    }
}
