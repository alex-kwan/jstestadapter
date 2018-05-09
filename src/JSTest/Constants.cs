﻿using JSTest.Settings;
using System;
using System.Collections.Generic;
using System.Text;

namespace JSTest
{
    internal static class Constants
    {
        public const int ClientConnectionTimeout = 60 * 1000;
        public const int MessageProtocolVersion = 1;
        public const int StreamBufferSize = 16384;
        public static class TestFrameworkStrings
        {
            public const string Jasmine = "jasmine";
            public const string Mocha = "mocha";
            public const string Jest = "jest";
        }
    }
}