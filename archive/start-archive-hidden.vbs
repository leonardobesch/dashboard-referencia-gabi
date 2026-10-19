' Inicia o arquivo local da ReferÃªncia Capital sem abrir janela (usado na inicializaÃ§Ã£o do Windows).
' Se o serviÃ§o jÃ¡ estiver rodando na porta 8789, a nova instÃ¢ncia encerra sozinha.
Set sh = CreateObject("WScript.Shell")
sh.Run """D:\Academy\Referencia-Capital\archive\run-archive.cmd""", 0, False
