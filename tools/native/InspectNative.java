// Locate selected native subsystems by string references and export bounded pseudocode.
// @category PS2
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.address.Address;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import com.google.gson.GsonBuilder;

public class InspectNative extends GhidraScript {
    private boolean physical(Function f) { long a=f.getEntryPoint().getOffset();return a>=0x100000L && a<0x41f900L; }
    @Override public void run() throws Exception {
        String[] args=getScriptArgs();if(args.length!=2)throw new IllegalArgumentException("Expected targets-file and output-directory");
        Path out=Paths.get(args[1]);Files.createDirectories(out.resolve("pseudocode"));Files.createDirectories(out.resolve("assembly"));
        Map<String,Function> roots=new TreeMap<>(),selected=new TreeMap<>();List<Map<String,Object>> strings=new ArrayList<>();List<String> unresolvedTargets=new ArrayList<>();
        for(String line:Files.readAllLines(Paths.get(args[0]))) {
            if(line.isBlank()||line.startsWith("#"))continue;
            if(line.startsWith("at:")){
                Function f=getFunctionContaining(toAddr(line.substring(3).split(" ",2)[0]));
                if(f==null||!physical(f)){unresolvedTargets.add(line);println("Unresolved physical function: "+line);continue;}
                if(roots.size()>=80)throw new IllegalArgumentException("Too many root functions; split the targets file");
                roots.put(f.getEntryPoint().toString(),f);continue;
            }
            if(line.startsWith("range:")){
                String[] range=line.split(":");long end=Long.parseLong(range[2],16);
                FunctionIterator iterator=currentProgram.getFunctionManager().getFunctions(toAddr(range[1]),true);
                while(iterator.hasNext()&&roots.size()<80){Function f=iterator.next();if(f.getEntryPoint().getOffset()>=end)break;if(physical(f))roots.put(f.getEntryPoint().toString(),f);}
                continue;
            }
            String[] parts=line.split(" ",2);Address target=toAddr(parts[0]);Map<String,Object> row=new LinkedHashMap<>();row.put("value",parts[1]);row.put("address",target.toString());List<String> refs=new ArrayList<>(),functions=new ArrayList<>();
            for(Reference ref:getReferencesTo(target)) {
                Address from=ref.getFromAddress();refs.add(from.toString());Function f=getFunctionContaining(from);
                if(f!=null&&physical(f)){roots.put(f.getEntryPoint().toString(),f);functions.add(f.getEntryPoint().toString());}
                if(f==null)for(Reference indirect:getReferencesTo(from)){Function parent=getFunctionContaining(indirect.getFromAddress());if(parent!=null&&physical(parent)){roots.put(parent.getEntryPoint().toString(),parent);functions.add(parent.getEntryPoint().toString());}}
            }
            row.put("references",refs);row.put("functions",functions);strings.add(row);
        }
        selected.putAll(roots);
        for(Function f:roots.values())for(Function callee:f.getCalledFunctions(monitor))if(physical(callee)&&selected.size()<80)selected.put(callee.getEntryPoint().toString(),callee);
        DecompInterface decompiler=new DecompInterface();List<Map<String,Object>> results=new ArrayList<>();int success=0;
        try {
            if(!decompiler.openProgram(currentProgram))throw new IllegalStateException(decompiler.getLastMessage());
            for(Function f:selected.values()) {
                String addr=f.getEntryPoint().toString();Map<String,Object> row=new LinkedHashMap<>();row.put("entry",addr);row.put("name",f.getName());row.put("root",roots.containsKey(addr));
                List<String> calls=new ArrayList<>();for(Function call:f.getCalledFunctions(monitor))calls.add(call.getEntryPoint().toString());Collections.sort(calls);row.put("calls",calls);
                StringBuilder asm=new StringBuilder();InstructionIterator iterator=currentProgram.getListing().getInstructions(f.getBody(),true);while(iterator.hasNext()){Instruction i=iterator.next();asm.append(i.getAddress()).append("  ").append(i).append('\n');}
                Files.writeString(out.resolve("assembly").resolve(addr+".asm"),asm.toString());
                DecompileResults result=decompiler.decompileFunction(f,20,monitor);
                if(result.decompileCompleted()&&result.getDecompiledFunction()!=null){Files.writeString(out.resolve("pseudocode").resolve(addr+".c"),"/* Decompiled pseudocode. Types and behaviour require verification. */\n"+result.getDecompiledFunction().getC());row.put("exported",true);success++;}
                else {row.put("exported",false);row.put("error",result.getErrorMessage());}
                results.add(row);
            }
        } finally {decompiler.dispose();}
        Map<String,Object> report=new LinkedHashMap<>();report.put("program",currentProgram.getName());report.put("language",currentProgram.getLanguageID().toString());report.put("strings",strings);report.put("roots",roots.size());report.put("attempted",results.size());report.put("exported",success);report.put("failed",results.size()-success);report.put("unresolvedTargets",unresolvedTargets);report.put("functions",results);
        Files.writeString(out.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));println("Native inspection: "+roots.size()+" roots, "+success+"/"+results.size()+" exports, "+unresolvedTargets.size()+" unresolved targets.");
    }
}
