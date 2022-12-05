import path = require('path');
import {Messages, Logger} from '@salesforce/core';
import {AsyncCreatable} from '@salesforce/kit';
import {Controller} from '../../Controller';
import * as JreSetupManager from '../JreSetupManager';
import {uxEvents, EVENTS} from '../ScannerEvents';
import {Rule, SfgeConfig, RuleTarget} from '../../types';
import {CommandLineSupport, ResultHandlerArgs} from '../services/CommandLineSupport';
import {SpinnerManager, NoOpSpinnerManager} from '../services/SpinnerManager';
import {FileHandler} from '../util/FileHandler';

// Here, current dir __dirname = <base_dir>/sfdx-scanner/src/lib/sfge
const SFGE_LIB = path.join(__dirname, '..', '..', '..', 'dist', 'sfge', 'lib');

const MAIN_CLASS = "com.salesforce.Main";
const EXEC_COMMAND = "execute";
const CATALOG_COMMAND = "catalog";
const SFGE_LOG_FILE = 'sfge.log';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('@salesforce/sfdx-scanner', 'SfgeEngine');

/**
 * By fiat, an exit code of 0 indicates a successful SFGE run with no violations detected.
 */
const EXIT_NO_VIOLATIONS = 0;
/**
 * By fiat, an exit code of 4 indicates a successful SFGE run in which violations were detected.
 */
const EXIT_WITH_VIOLATIONS = 4;

interface SfgeWrapperOptions {
	targets: RuleTarget[];
	projectDirs: string[];
	command: string;
	rules: Rule[];
	spinnerManager: SpinnerManager;
	jvmArgs?: string,
	ruleThreadCount?: number;
	ruleThreadTimeout?: number;
	ruleDisableWarningViolation?: boolean;
}

type SfgeTarget = {
	targetFile: string;
	targetMethods: string[];
};

type SfgeInput = {
	targets: SfgeTarget[];
	projectDirs: string[];
	rulesToRun: string[];
};

class SfgeSpinnerManager extends AsyncCreatable implements SpinnerManager {
	private initialized: boolean;
	private intervalId: NodeJS.Timeout;
	private logFilePath: string;

	protected init(): Promise<void> {
		if (this.initialized) {
			return Promise.resolve();
		}
		this.logFilePath = path.join(Controller.getSfdxScannerPath(), SFGE_LOG_FILE);
		this.initialized = true;
		return Promise.resolve();
	}

	public startSpinner(): void {
		uxEvents.emit(
			EVENTS.START_SPINNER,
			messages.getMessage("spinnerStart", [this.logFilePath]),
			messages.getMessage("pleaseWait")
		);

		// TODO: This timer logic should ideally live inside waitOnSpinner()
		this.intervalId = setInterval(() => {
			uxEvents.emit(EVENTS.WAIT_ON_SPINNER, 'message is unused');
		}, 30000);
	}

	public stopSpinner(success: boolean): void {
		clearInterval(this.intervalId);
		uxEvents.emit(EVENTS.STOP_SPINNER, success ? "Done": "Error");
	}
}

export class SfgeWrapper extends CommandLineSupport {
	private logger: Logger;
	private initialized: boolean;
	private fh: FileHandler;
	private targets: RuleTarget[];
	private projectDirs: string[];
	private command: string;
	private rules: Rule[];
	private logFilePath: string;
	private spinnerManager: SpinnerManager;
	private jvmArgs: string;
	private ruleThreadCount: number;
	private ruleThreadTimeout: number;
	private ruleDisableWarningViolation: boolean;

	constructor(options: SfgeWrapperOptions) {
		super(options);
		this.targets = options.targets;
		this.projectDirs = options.projectDirs;
		this.command = options.command;
		this.rules = options.rules;
		this.spinnerManager = options.spinnerManager;
		this.jvmArgs = options.jvmArgs;
		this.ruleThreadCount = options.ruleThreadCount;
		this.ruleThreadTimeout = options.ruleThreadTimeout;
		this.ruleDisableWarningViolation = options.ruleDisableWarningViolation;
	}

	protected async init(): Promise<void> {
		if (this.initialized) {
			return;
		}
		await super.init();
		this.logger = await Logger.child('SfgeWrapper');
		this.fh = new FileHandler();
		this.logFilePath = path.join(Controller.getSfdxScannerPath(), SFGE_LOG_FILE);
		this.initialized = true;
	}

	protected buildClasspath(): Promise<string[]> {
		return Promise.resolve([`${SFGE_LIB}/*`]);
	}

	private async createInputFile(input: SfgeInput): Promise<string> {
		const inputFile = await this.fh.tmpFileWithCleanup();
		await this.fh.writeFile(inputFile, JSON.stringify(input));
		return inputFile;
	}

	protected isSuccessfulExitCode(code: number): boolean {
		return code === EXIT_NO_VIOLATIONS || code === EXIT_WITH_VIOLATIONS;
	}

	/**
	 * While handling unsuccessful executions, include stdout
	 * and stderr information.
	 * @param args contains information on the outcome of execution
	 */
	protected handleResults(args: ResultHandlerArgs) {
		if (args.isSuccess) {
			args.res(args.stdout);
		} else {
			// Pass in both stdout and stderr so that results can be salvaged
			args.rej(args.stdout + ' ' + args.stderr);
		}
	}

	/**
	 * Returns a spinner that will be used while waiting for the child process to complete. For the CATALOG flow, this will
	 * be a {@link NoOpSpinnerManager}, and for the EXECUTE flow, this will be a {@link SfgeSpinnerManager}.
	 * @protected
	 * @override
	 */
	protected getSpinnerManager(): SpinnerManager {
		return this.spinnerManager;
	}

	protected async buildCommandArray(): Promise<[string, string[]]> {
		const javaHome = await JreSetupManager.verifyJreSetup();
		const command = path.join(javaHome, 'bin', 'java');
		const classpath = await this.buildClasspath();

		const inputObject: SfgeInput = this.createInputJson();
		const inputFile = await this.createInputFile(inputObject);

		this.logger.trace(`Stored the names of ${this.targets.length} targeted files and ${this.projectDirs.length} source directories in ${inputFile}`);
		this.logger.trace(`Rules to be executed: ${JSON.stringify(inputObject.rulesToRun)}`);

		const args = [`-Dsfge_log_name=${this.logFilePath}`, '-cp', classpath.join(path.delimiter)];
		if (this.jvmArgs != null) {
			args.push(this.jvmArgs);
		}
		if (this.ruleThreadCount != null) {
			args.push(`-DSFGE_RULE_THREAD_COUNT=${this.ruleThreadCount}`);
		}
		if (this.ruleThreadTimeout != null) {
			args.push(`-DSFGE_RULE_THREAD_TIMEOUT=${this.ruleThreadTimeout}`);
		}
		if (this.ruleDisableWarningViolation != null) {
			args.push(`-DSFGE_RULE_DISABLE_WARNING_VIOLATION=${this.ruleDisableWarningViolation.toString()}`);
		}
		args.push(MAIN_CLASS, this.command, inputFile);

		this.logger.trace(`Preparing to execute sfge with command: "${command}", args: "${JSON.stringify(args)}"`);
		return [command, args];
	}

	private async execute(): Promise<string> {
		return super.runCommand();
	}

	public static async getCatalog() {
		const wrapper = await SfgeWrapper.create({
			targets: [],
			projectDirs: [],
			command: CATALOG_COMMAND,
			rules: [],
			// Cataloging shouldn't take very long, so no need for a functional spinner here.
			spinnerManager: new NoOpSpinnerManager()
		});
		return wrapper.execute();
	}

	private createInputJson(): SfgeInput {
		const inputJson: SfgeInput = {
			targets: [],
			projectDirs: this.projectDirs,
			rulesToRun: this.rules.map(rule => rule.name)
		};
		this.targets.forEach(t => {
			// If the target specifies individual methods in a file, then create one object encompassing the file and
			// those methods.
			// NOTE: This code assumes that method-level targets cannot have multiple paths in the `paths` property. If
			// this assumption is ever invalidated, then this code must change.
			if (t.methods.length > 0) {
				inputJson.targets.push({
					targetFile: t.paths[0],
					targetMethods: t.methods
				});
			} else {
				// Otherwise, the target is a collection of paths encompassing whole files, and each path should be its
				// own subject.
				t.paths.forEach(p => {
					inputJson.targets.push({
						targetFile: p,
						targetMethods: []
					});
				});
			}
		});
		return inputJson;
	}

	public static async runSfge(targets: RuleTarget[], rules: Rule[], sfgeConfig: SfgeConfig): Promise<string> {
		const wrapper = await SfgeWrapper.create({
			targets,
			projectDirs: sfgeConfig.projectDirs,
			command: EXEC_COMMAND,
			rules: rules,
			// Running rules could take quite a while, so we should use a functional spinner.
			spinnerManager: await SfgeSpinnerManager.create({}),
			jvmArgs: sfgeConfig.jvmArgs,
			ruleThreadCount: sfgeConfig.ruleThreadCount,
			ruleThreadTimeout: sfgeConfig.ruleThreadTimeout,
			ruleDisableWarningViolation: sfgeConfig.ruleDisableWarningViolation
		});
		return wrapper.execute();
	}
}