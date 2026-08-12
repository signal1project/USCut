Dim sh
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\home\dalebrown138\projects\Social-Engine-USCut"
sh.Run "cmd /c npm run dev", 0, False
