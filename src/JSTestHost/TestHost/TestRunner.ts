import { TestRunCriteriaWithSources } from '../ObjectModel/Payloads/TestRunCriteriaWithSources';
import { TestFrameworkProvider, TestFramework } from './TestFrameworks/TestFrameworkProvider';
import { IEnvironment, EnvironmentType } from '../Environment/IEnvironment';
import { TestCase } from '../ObjectModel/TestCase';
import { TestResult } from '../ObjectModel/TestResult';
import { ITestFramework } from './TestFrameworks/ITestFramework';
import { TestSessionEventArgs, TestCaseEventArgs, TestSuiteEventArgs } from './TestFrameworks/TestFrameworkEventArgs';
import { TestExecutionCache } from './TestExecutionCache';
import { TimeSpan } from '../Utils/TimeSpan';
import { ICommunicationManager } from '../Environment/ICommunicationManager';
import { MessageType } from '../ObjectModel/MessageType';
import { TestRunChangedEventArgs } from '../ObjectModel/Payloads/TestRunChangedEventArgs';
import { Message } from '../ObjectModel/Message';
import { TestRunCompleteEventArgs } from '../ObjectModel/EventArgs/TestRunCompleteEventArgs';
import { TestRunCompletePayload } from '../ObjectModel/Payloads/TestRunCompletePayload';
import { DiscoveryCriteria } from '../ObjectModel/Payloads/DiscoveryCriteria';
import { Event, IEventArgs } from '../Events/Event';
import { TestDiscoveryCache } from './TestDiscoveryCache';
import { TestsDiscoveredEventArgs } from '../ObjectModel/EventArgs/TestsDiscoveredEventArgs';
import { DiscoveryCompletePayload } from '../ObjectModel/Payloads/DiscoveryCompletePayload';
import { CSharpException } from '../Exceptions/CSharpException';
import { TestMessagePayload } from '../ObjectModel/Payloads/TestMessagePayload';
import { TestMessageLevel } from '../ObjectModel/TestMessageLevel';
import { Exception, ExceptionType } from '../Exceptions/Exception';

interface FrameworkEventHandlers {
    Subscribe: (framework: ITestFramework) => void;
    TestSessionStart: (sender: object, args: TestSessionEventArgs) => void;
    TestSessionEnd: (sender: object, args: TestSessionEventArgs) => void;
    TestSuiteStart: (sender: object, args: TestSuiteEventArgs) => void;
    TestSuiteEnd: (sender: object, args: TestSuiteEventArgs) => void;
    TestCaseStart: (sender: object, args: TestCaseEventArgs) => void;
    TestCaseEnd: (sender: object, args: TestCaseEventArgs) => void;
}

export class TestRunner {

    private readonly environment: IEnvironment;
    private readonly communicationManager: ICommunicationManager;
    private onComplete: Event<IEventArgs>;
    private testExecutionCache: TestExecutionCache;
    private testDiscoveryCache: TestDiscoveryCache;
    private runner: TestFramework = TestFramework.Mocha;
    private currentTestSession: TestSessionEventArgs;

    constructor(environment: IEnvironment, communicationManager: ICommunicationManager) {
        this.environment = environment;
        this.communicationManager = communicationManager;
        this.onComplete = environment.createEvent();
    }

    public discoverTests(criteria: DiscoveryCriteria): Promise<void> {
        const framework = TestFrameworkProvider.getTestFramework(this.runner, this.environment);
        const sources = criteria.AdapterSourceMap[Object.keys(criteria.AdapterSourceMap)[0]];

        this.testDiscoveryCache = new TestDiscoveryCache(this.environment,
                                                         criteria.FrequencyOfDiscoveredTestsEvent,
                                                         criteria.DiscoveredTestEventTimeout);

        this.testDiscoveryCache.onReportTestCases.subscribe(this.testDiscoveryStatsChange);

        this.discoveryEventHandlers.Subscribe(framework);
        framework.startDiscovery(sources[0]);

        return new Promise((resolve) => {
            this.onComplete.subscribe((sender: object, args: IEventArgs) => { resolve(); });
        });
    }

    public startTestRunWithSources(criteria: TestRunCriteriaWithSources): Promise<void> {
        const framework = TestFrameworkProvider.getTestFramework(this.runner, this.environment);
        const sources = criteria.AdapterSourceMap[Object.keys(criteria.AdapterSourceMap)[0]];

        this.testExecutionCache = new TestExecutionCache(this.environment,
                                                         criteria.TestExecutionContext.FrequencyOfRunStatsChangeEvent,
                                                         criteria.TestExecutionContext.RunStatsChangeEventTimeout);

        this.testExecutionCache.onTestRunStatsChange.subscribe(this.testRunStatsChange);

        this.executionEventHandlers.Subscribe(framework);

        return new Promise((resolve) => {
            try {
                this.runInIsolation(() => {
                    framework.startExecution(sources[0]);
                });
            } catch (e) {
                this.executionCompleteWithErrors(e);
            }

            this.onComplete.subscribe((sender: object, args: IEventArgs) => {
                resolve();
            });
        });
    }

    private runInIsolation(action: () => void) {
        if (this.environment.environmentType === EnvironmentType.NodeJS) {
            // tslint:disable-next-line:no-require-imports
            const d = require('domain').create();
            d.on('error', (er) => {
                /* THIS IS POTENTIALLY A BAD IDEA
                 * The error won't crash the process, but what it does is worse!
                 * Though we've prevented abrupt process restarting, we are leaking
                 * resources like crazy if this ever happens.
                 * This is no better than process.on('uncaughtException')!
                 * 
                 * But since after this error we're essentially going to shut down execution
                 * It is fine to do this as long as JSTestHost only handles single sources */

                this.executionCompleteWithErrors(er);
            });
            d.run(() => {
                action();
            });
        } else if (this.environment.environmentType === EnvironmentType.Browser) {
            throw new Exception('TestRunner.runInIsolation: Not implemented for browser',
                                ExceptionType.NotImplementedException);
        }
    }

    private executionCompleteWithErrors(err: Error): void {
        console.log('test session end trigger');
        const remainingTestResults = this.testExecutionCache.cleanCache();

        const testRunCompleteEventArgs = <TestRunCompleteEventArgs> {
            TestRunStatistics: remainingTestResults.TestRunStatistics,
            IsCanceled: false,
            IsAborted: false,
            Error: null,
            AttachmentSets: [],
            ElapsedTimeInRunningTests: TimeSpan.MSToString(new Date().getTime() - this.currentTestSession.StartTime.getTime()),
            Metrics: {}
        };

        testRunCompleteEventArgs.Error = new CSharpException(err, this.currentTestSession.Source);

        // TODO hardcoded executor uris
        const testRuncompletePayload = <TestRunCompletePayload> {
            TestRunCompleteArgs: testRunCompleteEventArgs,
            LastRunTests: remainingTestResults,
            RunAttachments: [],
            ExecutorUris: ['executor: //JasmineTestAdapter/v1']
        };

        const testMessagePayload = <TestMessagePayload> {
            MessageLevel: TestMessageLevel.Error,
            Message: err.stack ? err.stack : (err.constructor.name + ': ' + err.message + ' at ' + this.currentTestSession.Source)
        };

        this.communicationManager.sendMessage(new Message(MessageType.TestMessage, testMessagePayload, 2));
        this.communicationManager.sendMessage(new Message(MessageType.ExecutionComplete, testRuncompletePayload, 2));
        this.onComplete.raise(this, null);
    }

    private executionEventHandlers: FrameworkEventHandlers = {
        Subscribe: (framework: ITestFramework) => {
            framework.onTestSessionStart.subscribe(this.executionEventHandlers.TestSessionStart);
            framework.onTestSessionEnd.subscribe(this.executionEventHandlers.TestSessionEnd);
            // framework.onTestSuiteStart.subscribe(this.executionEventHandlers.TestSuiteStart);
            // framework.onTestSuiteEnd.subscribe(this.executionEventHandlers.TestSuiteEnd);
            framework.onTestCaseStart.subscribe(this.executionEventHandlers.TestCaseStart);
            framework.onTestCaseEnd.subscribe(this.executionEventHandlers.TestCaseEnd);
        },

        TestSessionStart: (sender: object, args: TestSessionEventArgs) => {
            this.currentTestSession = args;
        },

        TestSessionEnd: (sender: object, args: TestSessionEventArgs) => {
            console.log('test session end trigger');
            const remainingTestResults = this.testExecutionCache.cleanCache();

            const testRunCompleteEventArgs = <TestRunCompleteEventArgs> {
                TestRunStatistics: remainingTestResults.TestRunStatistics,
                IsCanceled: false,
                IsAborted: false,
                Error: null,
                AttachmentSets: [],
                ElapsedTimeInRunningTests: TimeSpan.MSToString(args.EndTime.getTime() - args.StartTime.getTime()),
                Metrics: {}
            };

            // TODO hardcoded executor uris
            const testRuncompletePayload = <TestRunCompletePayload> {
                TestRunCompleteArgs: testRunCompleteEventArgs,
                LastRunTests: remainingTestResults,
                RunAttachments: [],
                ExecutorUris: ['executor: //JasmineTestAdapter/v1']
            };

            this.communicationManager.sendMessage(new Message(MessageType.ExecutionComplete, testRuncompletePayload, 2));

            this.onComplete.raise(this, null);
        },

        TestSuiteStart: (sender: object, args: TestSuiteEventArgs) => {
            return;
        },

        TestSuiteEnd: (sender: object, args: TestSuiteEventArgs) => {
            return;
        },

        TestCaseStart: (sender: object, args: TestCaseEventArgs) => {
            console.log('adding test case to cache');
            this.testExecutionCache.addInProgressTest(args.TestCase);
        },

        TestCaseEnd: (sender: object, args: TestCaseEventArgs) => {
            console.log('adding test result to cache');

            // TODO incomplete test results - display name etc are null

            const testResult: TestResult = {
                TestCase: args.TestCase,
                Attachments: [],
                Outcome: args.Outcome,
                ErrorMessage: null,
                ErrorStackTrace: null,
                DisplayName: null,
                Messages: [],
                ComputerName: null,
                Duration: TimeSpan.MSToString(args.EndTime.getTime() - args.StartTime.getTime()),
                StartTime: args.StartTime,
                EndTime: args.EndTime
            };

            if (args.FailedExpectations.length > 0) {
                testResult.ErrorMessage = args.FailedExpectations[0].Message;
                testResult.ErrorStackTrace = args.FailedExpectations[0]. StackTrace;
            }

            this.testExecutionCache.addTestResult(testResult);
        }
    };

    private discoveryEventHandlers: FrameworkEventHandlers = {
        Subscribe: (framework: ITestFramework) => {
            // framework.onTestSessionStart.subscribe(this.TestSessionStart);
            framework.onTestSessionEnd.subscribe(this.discoveryEventHandlers.TestSessionEnd);
            // // framework.onTestSuiteStart.subscribe(this.TestSuiteStart);
            // // framework.onTestSuiteEnd.subscribe(this.TestSuiteEnd);
            framework.onTestCaseStart.subscribe(this.discoveryEventHandlers.TestCaseStart);
            // framework.onTestCaseEnd.subscribe(this.discoveryEventHandlers.TestCaseEnd);
        },

        TestSessionStart: (sender: object, args: TestSessionEventArgs) => {
            return;
        },

        TestSessionEnd: (sender: object, args: TestSessionEventArgs) => {
            console.log('test session end trigger');
            const remainingTests = this.testDiscoveryCache.cleanCache();

            const discoveryCompletePayload: DiscoveryCompletePayload = {
                Metrics: {},
                TotalTests: remainingTests.TotalTestsDiscovered,
                LastDiscoveredTests: remainingTests.DiscoveredTests,
                IsAborted: false
            };

            this.communicationManager.sendMessage(new Message(MessageType.DiscoveryComplete, discoveryCompletePayload, 2));

            this.onComplete.raise(this, null);
        },

        TestSuiteStart: (sender: object, args: TestSuiteEventArgs) => {
            return;
        },

        TestSuiteEnd: (sender: object, args: TestSuiteEventArgs) => {
            return;
        },

        TestCaseStart: (sender: object, args: TestCaseEventArgs) => {
            console.log('adding test case to cache');
            this.testDiscoveryCache.addTest(args.TestCase);
        },

        TestCaseEnd: (sender: object, args: TestCaseEventArgs) => {
            return;
        }
    };

    private testRunStatsChange = (sender: object, args: TestRunChangedEventArgs) => {
        console.log('test run stats change');

        const testRunChangedMessaged = new Message(MessageType.TestRunStatsChange, args, 2);
        this.communicationManager.sendMessage(testRunChangedMessaged);
    }

    private testDiscoveryStatsChange = (sender: object, args: TestsDiscoveredEventArgs) => {
        console.log('tests discovered');

        const testsFoundMessage = new Message(MessageType.TestCasesFound, args.DiscoveredTests, 2);
        this.communicationManager.sendMessage(testsFoundMessage);
    }
}