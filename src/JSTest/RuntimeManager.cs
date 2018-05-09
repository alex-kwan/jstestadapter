﻿using JSTest.Settings;
using Microsoft.VisualStudio.TestPlatform.ObjectModel;
using Microsoft.VisualStudio.TestPlatform.ObjectModel.Host;
using Microsoft.VisualStudio.TestPlatform.ObjectModel.Logging;
using Microsoft.VisualStudio.TestPlatform.PlatformAbstractions.Interfaces;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JSTest.Communication;
using System.IO;
using Microsoft.VisualStudio.TestPlatform.PlatformAbstractions;
using JSTest.JSRuntime;

namespace JSTest
{
    internal class TestRuntimeManager
    {
        private JSTestSettings settings;
        private StringBuilder processStdError;
        private readonly IMessageLogger messageLogger;
        private readonly JSProcess jsProcess;
        private readonly JsonDataSerializer dataSerializer;

        protected int ErrorLength { get; set; } = 4096;

        public event EventHandler<HostProviderEventArgs> HostLaunched;

        public event EventHandler<HostProviderEventArgs> HostExited;

        public TestRunEvents TestRunEvents { private set; get; }

        public TestRuntimeManager(TestRunEvents testRunEvents, JsonDataSerializer dataSerializer, IProcessHelper processHelper, JSProcess process)
        {
            this.TestRunEvents = TestRunEvents;
            this.dataSerializer = dataSerializer;
            this.jsProcess = process;
        }

        public TestRuntimeManager(JSTestSettings settings)
            : this(new TestRunEvents(), JsonDataSerializer.Instance, new ProcessHelper(), new JSProcess())
        {
            this.settings = settings;
        }

        private Action<object> ProcessExitReceived => (process) =>
        {
            //TestHostManagerCallbacks.ExitCallBack(this.processHelper, process, this.testHostProcessStdError, this.OnHostExited);
        };

        private Action<object, string> ProcessOutputReceived => (process, data) =>
        {

        };

        private Action<object, string> ProcessErrorReceived => (process, data) =>
        {
            this.errorReceivedCallback(this.processStdError, data);

            var errorString = this.processStdError.ToString();
            if (!string.IsNullOrEmpty(errorString))
            {
                //messageLogger.SendMessage(TestMessageLevel.Error, errorString);
                Console.Error.Write(errorString);
            }
        };

        public void errorReceivedCallback(StringBuilder testHostProcessStdError, string data)
        {
            if (!string.IsNullOrEmpty(data))
            {
                testHostProcessStdError.Clear();

                // Log all standard error message because on too much data we ignore starting part.
                // This is helpful in abnormal failure of testhost.
                EqtTrace.Warning("Test host standard error line: {0}", data);

                // Add newline for readbility.
                data += Environment.NewLine;

                // if incoming data stream is huge empty entire testError stream, & limit data stream to MaxCapacity
                if (data.Length > testHostProcessStdError.MaxCapacity)
                {
                    testHostProcessStdError.Clear();
                    data = data.Substring(data.Length - testHostProcessStdError.MaxCapacity);
                }

                // remove only what is required, from beginning of error stream
                else
                {
                    int required = data.Length + testHostProcessStdError.Length - testHostProcessStdError.MaxCapacity;
                    if (required > 0)
                    {
                        testHostProcessStdError.Remove(0, required);
                    }
                }

                testHostProcessStdError.Append(data);
            }
        }

        public Task CleanProcessAsync(CancellationToken cancellationToken)
        {
            try
            {
                this.jsProcess.TerminateProcess();
            }
            catch (Exception ex)
            {
                EqtTrace.Warning("JSTestHostManager: Unable to terminate test host process: " + ex);
            }

            return Task.FromResult(true);
        }

        public async Task<bool> LaunchProcessAsync(ProcessStartInfo runtimeProcessStartInfo, CancellationToken cancellationToken)
        {
            return await Task.Run(() =>
            {
                try
                {
                    this.processStdError = new StringBuilder(this.ErrorLength, this.ErrorLength);
                    EqtTrace.Verbose("DotnetTestHostManager: Starting process '{0}' with command line '{1}'", runtimeProcessStartInfo.FileName, runtimeProcessStartInfo.Arguments);

                    cancellationToken.ThrowIfCancellationRequested();

                    this.jsProcess.LaunchProcess(runtimeProcessStartInfo, this.ProcessErrorReceived, this.ProcessExitReceived);

                }
                catch (OperationCanceledException ex)
                {
                    EqtTrace.Error("DotnetTestHostManager.LaunchHost: Failed to launch testhost: {0}", ex);
                    //this.messageLogger.SendMessage(TestMessageLevel.Error, ex.ToString());
                    Console.Write(ex);
                    return false;
                }

                //this.OnHostLaunched(new HostProviderEventArgs("Test Runtime launched", 0, this.testHostProcess.Id));
                this.InitializeCommunication();
                Task.Run(() => { this.MessageLoopAsync(this.jsProcess.CommunicationChannel, cancellationToken); }).Wait();

                return this.jsProcess.IsAlive;
            });
        }

        public SendStartExecution(IEnumerable<string> sources)
        {
            var message = this.dataSerializer.SerializePayload(MessageType)
        }

        public void SendMessage(string messageType, object payload)
        {
            var message = this.dataSerializer.SerializePayload(messageType, payload);
            this.jsProcess.CommunicationChannel.Send(message);
        }

        private void InitializeCommunication()
        {
            if (jsProcess.IsAlive)
            {
                this.jsProcess.CommunicationChannel.MessageReceived += onMessageReceived;
                this.SendMessage(MessageType.TestRunSettings, settings);

                Task.Run(() => this.jsProcess.CommunicationChannel.NotifyDataAvailable()).Wait();
            }
        }

        private Task MessageLoopAsync(CommunicationChannel channel, CancellationToken cancellationToken)
        {
            Exception error = null;

            // Set read timeout to avoid blocking receive raw message
            while (channel != null && !cancellationToken.IsCancellationRequested && this.jsProcess.IsAlive)
            {
                try
                {
                    channel.NotifyDataAvailable();
                }
                catch (Exception exception)
                {
                    EqtTrace.Error(
                            "Socket: Message loop: failed to receive message {0}",
                            exception);
                    error = exception;
                    break;
                }
            }

            // Try clean up and raise client disconnected events
            //errorHandler(error);

            return Task.FromResult(0);
        }

        private void onMessageReceived(object sender, MessageReceivedEventArgs e)
        {
            var message = this.dataSerializer.DeserializeMessage(e.Data);

            switch(message.MessageType)
            {
                case MessageType.VersionCheck:
                    var version = this.dataSerializer.DeserializePayload<int>(message);

                    if (version != Constants.MessageProtocolVersion)
                    {
                        throw new Exception("");
                    }

                    break;

                default:
                    Console.Error.Write(e.Data);
                    break;
            }

        }
    }
}