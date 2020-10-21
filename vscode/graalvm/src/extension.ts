/*
 * Copyright (c) 2019, 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as utils from './utils';
import { toggleCodeCoverage, activeTextEditorChaged } from './graalVMCoverage';
import { GraalVMConfigurationProvider, GraalVMDebugAdapterDescriptorFactory, GraalVMDebugAdapterTracker } from './graalVMDebug';
import { installGraalVM, addExistingGraalVM, installGraalVMComponent, uninstallGraalVMComponent, selectInstalledGraalVM, findGraalVMs, InstallationNodeProvider, Component, Installation, setupProxy, removeGraalVMInstallation } from './graalVMInstall';
import { startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { installRPackage, rConfig, R_LANGUAGE_SERVER_PACKAGE_NAME } from './graalVMR';
import { installRubyGem, rubyConfig, RUBY_LANGUAGE_SERVER_GEM_NAME } from './graalVMRuby';
import { addNativeImageToPOM } from './graalVMNativeImage';
import { pythonConfig } from './graalVMPython';

const INSTALL_GRAALVM: string = 'Install GraalVM';
const SELECT_EXISTING_GRAALVM: string = 'Select Existing GraalVM';
const SELECT_ACTIVE_GRAALVM: string = 'Select Active GraalVM';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.selectGraalVMHome', (installation?: Installation) => {
		selectInstalledGraalVM(installation ? installation.home : undefined);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVM', () => {
		installGraalVM(context.extensionPath);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addExistingGraalVM', () => {
		addExistingGraalVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVMComponent', (component: string | Component, homeFolder?: string) => {
		installGraalVMComponent(component, homeFolder, context.extensionPath);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.uninstallGraalVMComponent', (component: string | Component, homeFolder?: string) => {
		uninstallGraalVMComponent(component, homeFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addNativeImageToPOM', () => {
		addNativeImageToPOM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleCodeCoverage', () => {
		toggleCodeCoverage(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installRLanguageServer', () => {
		if(!installRPackage(R_LANGUAGE_SERVER_PACKAGE_NAME)){
			vscode.window.showErrorMessage("R isn't present in GraalVM Installation.");
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installRubyLanguageServer', () => {
		if(!installRubyGem(RUBY_LANGUAGE_SERVER_GEM_NAME)){
			vscode.window.showErrorMessage("Ruby isn't present in GraalVM Installation.");
		}
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => {
		if (e) {
			activeTextEditorChaged(e);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.setupProxy' , () => {
		setupProxy();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.removeInstallation', (path?: string | Installation) => {
		removeGraalVMInstallation(path instanceof Installation ? path.home : path);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.refreshLanguageConfigurations', (path: string) => {
		refreshLanguageConfigurations(path);
	}));

	const nodeProvider = new InstallationNodeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('graalvm-installations', nodeProvider));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.refreshInstallations', () => nodeProvider.refresh()));
	const configurationProvider = new GraalVMConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('graalvm', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('node', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('graalvm', new GraalVMDebugAdapterDescriptorFactory()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('graalvm', new GraalVMDebugAdapterTracker()));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('graalvm.home')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
			config();
			stopLanguageServer().then(() => startLanguageServer(utils.getGVMHome()));
		} else if (e.affectsConfiguration('graalvm.installations')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
		} else if (e.affectsConfiguration('graalvm.languageServer.currentWorkDir') || e.affectsConfiguration('graalvm.languageServer.inProcessServer')) {
			stopLanguageServer().then(() => startLanguageServer(utils.getGVMHome()));
		}
	}));
	const graalVMHome = utils.getGVMHome();
	if (!graalVMHome) {
		findGraalVMs().then(vms => {
			const items: string[] = vms.length > 0 ? [SELECT_ACTIVE_GRAALVM, INSTALL_GRAALVM] : [SELECT_EXISTING_GRAALVM, INSTALL_GRAALVM];
			vscode.window.showInformationMessage('No active GraalVM installation found.', ...items).then(value => {
				switch (value) {
					case SELECT_EXISTING_GRAALVM:
						vscode.commands.executeCommand('extension.graalvm.addExistingGraalVM');
						break;
					case SELECT_ACTIVE_GRAALVM:
						vscode.commands.executeCommand('extension.graalvm.selectGraalVMHome');
						break;
					case INSTALL_GRAALVM:
						vscode.commands.executeCommand('extension.graalvm.installGraalVM');
						break;
				}
			});
		});
	} else {
		config();
		startLanguageServer(graalVMHome);
	}
	vscode.window.setStatusBarMessage('GraalVM extension activated', 3000);
}

export function deactivate(): Thenable<void> {
	return stopLanguageServer();
}


function config() {
	const graalVMHome = utils.getGVMHome();
	if (graalVMHome) {
		const termConfig = utils.getConf('terminal.integrated');
		let section: string = '';
		if (process.platform === 'linux') {
			section = 'env.linux';
		} else if (process.platform === 'darwin') {
			section = 'env.osx';
		} else if (process.platform === 'win32') {
			section = 'env.windows';
		}
		let env: any = termConfig.get(section);
		if (env === undefined) {
			throw new Error(`Unable to find platform-specific env for platform "${process.platform}"`);
		}
		env.GRAALVM_HOME = graalVMHome;
		env.JAVA_HOME = graalVMHome;
		let envPath = process.env.PATH;
		if (envPath) {
			if (!envPath.includes(`${graalVMHome}/bin`)) {
				env.PATH = `${graalVMHome}/bin:${envPath}`;
			}
		} else {
			env.PATH = `${graalVMHome}/bin`;
		}
		termConfig.update(section, env, true);
		const javaConfig = utils.getConf('java');
		if (javaConfig) {
			const mvnConfig = utils.getConf('maven');
			if (mvnConfig) {
				const terminalEnv = javaConfig.inspect('terminal.customEnv');
				if (terminalEnv) {
					mvnConfig.update('terminal.customEnv', [{"environmentVariable": "JAVA_HOME", "value": graalVMHome}], true);
				}		
			}
		}
		refreshLanguageConfigurations(graalVMHome);
	}
}

function refreshLanguageConfigurations(graalVMHome: string) {
	pythonConfig(graalVMHome);
	rConfig(graalVMHome);
	rubyConfig(graalVMHome);
}
