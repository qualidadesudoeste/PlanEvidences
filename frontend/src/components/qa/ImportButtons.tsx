import { useRef, useState } from 'react';
import { FileJson, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { parsearCardsSig, parsearHUDeDocumento, type SigCard, type SigJSONItem } from '@/lib/qa/sigParser';
import { extrairTextoDeArquivo } from '@/lib/qa/docExtract';

interface Props {
  onImported: (cards: SigCard[]) => void;
  disabled?: boolean;
}

export function ImportButtons({ onImported, disabled }: Props) {
  const { toast } = useToast();
  const jsonRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  const handleJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setWorking(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        toast({ variant: 'error', title: 'JSON inválido', description: 'Esperado um array de HUs.' });
        return;
      }
      const cards = parsearCardsSig(data as SigJSONItem[]);
      if (cards.length === 0) {
        toast({
          variant: 'error',
          title: 'Nenhuma HU válida no JSON',
          description: 'É preciso ter descrição (≥20 caracteres) ou pelo menos 1 cenário BDD.',
        });
        return;
      }
      const totalCen = cards.reduce((acc, c) => acc + (c.cenarios?.length || 0), 0);
      onImported(cards);
      toast({
        variant: 'success',
        title: `${cards.length} HU(s) importadas`,
        description:
          totalCen > 0
            ? `${totalCen} cenário(s) BDD detectado(s).`
            : 'Sem cenários BDD — ative a IA para gerar casos ricos.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro lendo JSON',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorking(false);
    }
  };

  const handleDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    setWorking(true);
    const cards: SigCard[] = [];
    const falhas: string[] = [];

    for (const file of files) {
      try {
        const texto = await extrairTextoDeArquivo(file);
        cards.push(parsearHUDeDocumento(texto, file.name));
      } catch (err) {
        console.error(`[import ${file.name}]`, err);
        falhas.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (cards.length === 0) {
      toast({
        variant: 'error',
        title: 'Nenhuma HU extraída',
        description: falhas[0] || 'Verifique se os arquivos têm o formato esperado.',
      });
      setWorking(false);
      return;
    }

    onImported(cards);

    const totalCen = cards.reduce((acc, c) => acc + (c.cenarios?.length || 0), 0);
    const totalCrit = cards.reduce((acc, c) => acc + (c.criterios?.length || 0), 0);
    toast({
      variant: falhas.length > 0 ? 'warning' : 'success',
      title: `${cards.length} HU(s) importadas`,
      description: `${totalCen} cenário(s) BDD, ${totalCrit} critério(s)${
        falhas.length > 0 ? ` — ${falhas.length} arquivo(s) com falha.` : '.'
      }`,
    });

    setWorking(false);
  };

  const isDisabled = disabled || working;

  return (
    <>
      <input
        ref={jsonRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleJSON}
      />
      <input
        ref={docRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        style={{ display: 'none' }}
        onChange={handleDoc}
      />

      <Button variant="secondary" onClick={() => jsonRef.current?.click()} disabled={isDisabled}>
        {working ? <Loader2 size={14} className="spin" /> : <FileJson size={14} />}
        Importar JSON
      </Button>
      <Button variant="secondary" onClick={() => docRef.current?.click()} disabled={isDisabled}>
        {working ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
        Importar PDF/DOCX
      </Button>
    </>
  );
}
