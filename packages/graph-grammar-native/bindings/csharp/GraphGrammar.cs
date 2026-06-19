using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace GraphGrammar;

/// <summary>
/// Thin P/Invoke wrapper over the graph-grammar-native C ABI.
/// Strings cross the boundary as NUL-terminated UTF-8 (JSON in, JSON out).
/// </summary>
public static class Native
{
    private const string Lib = "graph_grammar_native";

    static Native()
    {
        // Resolve the cdylib from GG_DLL, else by walking up to target/debug.
        NativeLibrary.SetDllImportResolver(typeof(Native).Assembly, (name, _, _) =>
            name == Lib ? NativeLibrary.Load(LocateDll()) : IntPtr.Zero);
    }

    private static string LocateDll()
    {
        var env = Environment.GetEnvironmentVariable("GG_DLL");
        if (!string.IsNullOrEmpty(env)) return env;

        var fileName = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? "graph_grammar_native.dll"
            : RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
                ? "libgraph_grammar_native.dylib"
                : "libgraph_grammar_native.so";

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var cand = Path.Combine(dir.FullName, "target", "debug", fileName);
            if (File.Exists(cand)) return cand;
        }
        throw new FileNotFoundException($"could not find {fileName}; run `cargo build` or set GG_DLL");
    }

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr gg_version();

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern int gg_apply_rule(byte[] ruleJson, byte[] graphJson, out IntPtr outJson);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern int gg_apply_rule_seeded(byte[] ruleJson, byte[] graphJson, uint seed, out IntPtr outJson);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr gg_engine_new(byte[] grammarJson, byte[]? startGraphJson, out IntPtr errOut);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern int gg_engine_run(IntPtr eng, int maxSteps, out IntPtr outJson);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern int gg_engine_graph(IntPtr eng, out IntPtr outJson);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern void gg_engine_free(IntPtr eng);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    private static extern void gg_string_free(IntPtr s);

    public static string Version() => Marshal.PtrToStringUTF8(gg_version()) ?? "";

    private static string Take(IntPtr ptr)
    {
        try { return Marshal.PtrToStringUTF8(ptr) ?? "{}"; }
        finally { gg_string_free(ptr); }
    }

    /// <summary>Build an engine, run it, and return the (applied, graphJson) pair.</summary>
    public static (int Applied, string GraphJson) RunGrammar(string grammarJson, int maxSteps = -1)
    {
        var eng = gg_engine_new(Utf8Z(grammarJson), null, out var errPtr);
        if (eng == IntPtr.Zero)
            throw new InvalidOperationException($"engine_new failed: {Take(errPtr)}");
        try
        {
            gg_engine_run(eng, maxSteps, out var runPtr);
            var applied = JsonDocument.Parse(Take(runPtr)).RootElement.GetProperty("applied").GetInt32();
            gg_engine_graph(eng, out var graphPtr);
            return (applied, Take(graphPtr));
        }
        finally
        {
            gg_engine_free(eng);
        }
    }

    /// <summary>Apply one rule to one graph. With a seed, takes the stochastic
    /// path. Returns the (code, resultJson) pair.</summary>
    public static (int Code, string Json) ApplyRule(string ruleJson, string graphJson, uint? seed = null)
    {
        IntPtr outPtr;
        var code = seed is { } s
            ? gg_apply_rule_seeded(Utf8Z(ruleJson), Utf8Z(graphJson), s, out outPtr)
            : gg_apply_rule(Utf8Z(ruleJson), Utf8Z(graphJson), out outPtr);
        try
        {
            return (code, Marshal.PtrToStringUTF8(outPtr) ?? "{}");
        }
        finally
        {
            gg_string_free(outPtr);
        }
    }

    private static byte[] Utf8Z(string s)
    {
        var bytes = Encoding.UTF8.GetBytes(s);
        var z = new byte[bytes.Length + 1];
        Array.Copy(bytes, z, bytes.Length);
        return z; // trailing 0 → NUL terminator
    }
}
