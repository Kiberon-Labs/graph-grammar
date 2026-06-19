using System.Text.Json;
using System.Text.Json.Nodes;
using GraphGrammar;

// Sample + conformance check: load the native .dll, apply the relabel fixture,
// and compare the result with the TypeScript engine's expected output.
//
//   dotnet run --project bindings/csharp

static string? FindFixtures()
{
    for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
    {
        var cand = Path.Combine(dir.FullName, "conformance", "fixtures");
        if (Directory.Exists(cand)) return cand;
    }
    return null;
}

// Compare two graphs up to id-renaming of created elements (the engine's uid()
// is volatile). Both sides apply the same ops in the same order, so the node and
// edge lists line up positionally; x/y are ignored.
static bool GraphsEquiv(JsonNode? got, JsonNode? want)
{
    static List<JsonNode> Arr(JsonNode? g, string k) =>
        (g?[k]?.AsArray() ?? new JsonArray()).Select(n => n!).ToList();
    static string Str(JsonNode n, string k) => n[k]?.GetValue<string>() ?? "";
    static string Props(JsonNode n)
    {
        // Key-order-independent: native serializes props sorted, the engine by
        // insertion order. Our prop values are scalars, so sorting keys canonicalizes.
        var p = n["props"]?.AsObject();
        if (p is null) return "{}";
        var sorted = new JsonObject();
        foreach (var kv in p.OrderBy(kv => kv.Key, StringComparer.Ordinal)) sorted[kv.Key] = kv.Value?.DeepClone();
        return sorted.ToJsonString();
    }

    var (gn, wn) = (Arr(got, "nodes"), Arr(want, "nodes"));
    if (gn.Count != wn.Count) return false;
    var idMap = new Dictionary<string, string>();
    for (var i = 0; i < gn.Count; i++)
    {
        if (Str(gn[i], "label") != Str(wn[i], "label") || Props(gn[i]) != Props(wn[i])) return false;
        idMap[Str(gn[i], "id")] = Str(wn[i], "id");
    }
    var (ge, we) = (Arr(got, "edges"), Arr(want, "edges"));
    if (ge.Count != we.Count) return false;
    for (var i = 0; i < ge.Count; i++)
    {
        if (Str(ge[i], "label") != Str(we[i], "label")
            || ge[i]["directed"]?.ToJsonString() != we[i]["directed"]?.ToJsonString()
            || Props(ge[i]) != Props(we[i])) return false;
        if (!idMap.TryGetValue(Str(ge[i], "source"), out var ms) || ms != Str(we[i], "source")) return false;
        if (!idMap.TryGetValue(Str(ge[i], "target"), out var mt) || mt != Str(we[i], "target")) return false;
    }
    return true;
}

var fixtures = FindFixtures();
if (fixtures is null)
{
    Console.Error.WriteLine("FAIL: could not locate conformance/fixtures");
    return 1;
}

Console.WriteLine($"graph-grammar-native version: {Native.Version()}");

var names = Directory.EnumerateFiles(fixtures, "*.input.json")
    .Select(p => Path.GetFileName(p)[..^".input.json".Length])
    .OrderBy(n => n, StringComparer.Ordinal)
    .ToList();
if (names.Count == 0)
{
    Console.Error.WriteLine("FAIL: no fixtures found");
    return 1;
}

var failures = 0;
foreach (var name in names)
{
    var input = JsonNode.Parse(File.ReadAllText(Path.Combine(fixtures, $"{name}.input.json")))!;
    var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(fixtures, $"{name}.expected.json")));

    if (input["grammar"] is { } grammar) // multi-step engine run
    {
        var (applied, graphJson) = Native.RunGrammar(grammar.ToJsonString());
        if (!GraphsEquiv(JsonNode.Parse(graphJson), expected))
        {
            Console.Error.WriteLine($"FAIL [{name}]: engine run diverged");
            failures++;
            continue;
        }
        if (expected?["applied"] is { } wa && applied != wa.GetValue<int>())
        {
            Console.Error.WriteLine($"FAIL [{name}]: applied {applied} != {wa.GetValue<int>()}");
            failures++;
            continue;
        }
        Console.WriteLine($"PASS [{name}]: native engine run matches the TypeScript engine.");
        continue;
    }

    uint? seed = input["seed"] is { } s ? s.GetValue<uint>() : null;
    var (code, resultJson) = Native.ApplyRule(input["rule"]!.ToJsonString(), input["graph"]!.ToJsonString(), seed);
    if (code != 0)
    {
        Console.Error.WriteLine($"FAIL [{name}]: code {code}: {resultJson}");
        failures++;
        continue;
    }

    var result = JsonNode.Parse(resultJson)!;
    if (result["applied"]?.GetValue<bool>() != true)
    {
        Console.Error.WriteLine($"FAIL [{name}]: rule did not apply");
        failures++;
        continue;
    }

    if (!GraphsEquiv(result["graph"], expected))
    {
        Console.Error.WriteLine($"FAIL [{name}]: native output diverged");
        failures++;
        continue;
    }
    Console.WriteLine($"PASS [{name}]: native DLL output matches the TypeScript engine.");
}

return failures == 0 ? 0 : 1;
