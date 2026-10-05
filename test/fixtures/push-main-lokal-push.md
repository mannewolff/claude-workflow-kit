Aus dem Worktree, der auf einem losgelösten `HEAD` steht:

```bash
git push origin HEAD:<mainBranch>
```

**Kein `--force`, auch nicht nach dem Rebase.** Der Push ist nach Schritt 3 ein
Fast-Forward; wird er abgewiesen, ist `origin` zwischenzeitlich weitergelaufen — dann endet
der Lauf mit dieser Meldung, und der Mensch entscheidet.
