﻿using System;
using System.Collections.Generic;
using System.Text;

namespace JSTest.TestAdapter
{
    public static class AdapterConstants
    {

        public const string ExecutorUri = "executor://JSTestAdapter/v1";
        public const string SettingsName = "JSTest";

        public static class RunSettingsXml
        {
            public const string TestFrameworkOptions = "TestFrameworkOptions";
        }
        internal static class FileExtensions
        {
            public const string JavaScript = ".js";
            public const string JSON = ".json";
        }
    }
}
