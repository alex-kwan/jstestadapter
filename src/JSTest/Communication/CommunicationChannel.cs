﻿// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

namespace JSTest.Communication
{
    using Microsoft.VisualStudio.TestPlatform.ObjectModel;
    using Microsoft.VisualStudio.TestPlatform.PlatformAbstractions;
    using Microsoft.VisualStudio.TestPlatform.Utilities;
    using System;
    using System.IO;
    using System.Text;
    using System.Threading.Tasks;

    /// <summary>
    /// A communication channel using a length prefix packet frame for communication.
    /// </summary>
    public class CommunicationChannel 
    {
        private readonly BinaryReader reader;
        private readonly BinaryWriter writer;

        /// <summary>
        /// Sync object for sending messages
        /// Write for binarywriter is NOT thread-safe
        /// </summary>
        private object writeSyncObject = new object();

        public CommunicationChannel(Stream inputStream, Stream outputStream)
        {
            this.reader = new BinaryReader(outputStream, Encoding.UTF8, true);

            // Using the Buffered stream while writing, improves the write performance. By reducing the number of writes.
            this.writer = new BinaryWriter(new PlatformStream().CreateBufferedStream(inputStream, JSTest.Constants.StreamBufferSize), Encoding.UTF8, true);
        }

        /// <inheritdoc />
        public event EventHandler<MessageReceivedEventArgs> MessageReceived;

        /// <inheritdoc />
        public Task Send(string data)
        {
            try
            {
                // Writing Message on binarywriter is not Thread-Safe
                // Need to sync one by one to avoid buffer corruption
                lock (this.writeSyncObject)
                {
                    this.writer.Write(data);
                    this.writer.Flush();
                }
            }
            catch (Exception ex)
            {
                EqtTrace.Error("LengthPrefixCommunicationChannel.Send: Error sending data: {0}.", ex);
                throw new Exception("Unable to send data over channel.", ex);
            }

            return Task.FromResult(0);
        }

        /// <inheritdoc />
        public Task NotifyDataAvailable()
        {
            // Try read data even if no one is listening to the data stream. Some server
            // implementations (like Sockets) depend on the read operation to determine if a
            // connection is closed.
            if (this.MessageReceived != null)
            {
                var data = this.reader.ReadString();
                this.MessageReceived.SafeInvoke(this, new MessageReceivedEventArgs { Data = data }, "CommunicationChannel: MessageReceived");
            }

            return Task.FromResult(0);
        }

        /// <inheritdoc />
        public void Dispose()
        {
            EqtTrace.Verbose("LengthPrefixCommunicationChannel.Dispose: Dispose reader and writer.");
            this.reader.Dispose();
            this.writer.Dispose();
        }
    }
}