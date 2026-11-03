# SpaceCom

Programa em JavaScript para detectar encontros a partir de arquivos de geolocalização. Compara posições no mesmo timestamp e registra os pares com distância menor que 20 metros. O cálculo usa Haversine, com raio da Terra de 6.371.000 metros.

## Como rodar

É preciso ter Node.js 18 ou superior e npm. O projeto usa apenas módulos nativos do Node, então não precisa instalar dependências.

Coloque os arquivos `dataset1.txt` até `dataset7.txt` na pasta `inputs/`. Na raiz do projeto, execute:

```sh
npm test
npm start
npm run verify
```

`npm test` roda os testes automatizados. `npm start` processa os arquivos de `inputs/` e salva os resultados em `outputs/`. `npm run verify` confere o formato, as distâncias e a unicidade dos JSONs.

Também dá para processar só um arquivo ou escolher outro diretório:

```sh
node src/cli.js --input inputs/dataset1.txt --output outputs/dataset1.json
node src/cli.js --input outro-diretorio --output resultados
node src/cli.js --help
```

Os caminhos são relativos ao diretório onde o comando é executado. No Windows, os mesmos comandos funcionam em um terminal com Node instalado ou dentro do Ubuntu/WSL.

## Como funciona

O programa lê o arquivo em blocos de 1 MiB e agrupa as posições pelo timestamp. Quando o horário muda, calcula os encontros daquele grupo e libera suas posições. A saída também é escrita aos poucos. Assim, não é preciso carregar o arquivo inteiro nem guardar todos os encontros em memória.

**A entrada deve estar ordenada por timestamp.** A ordem dos IDs dentro de cada horário não importa. Os sete arquivos atuais atendem a essa condição. Se um timestamp voltar no tempo, o programa interrompe aquele arquivo e informa a linha.

Para selecionar os pares que vale a pena comparar, há duas estratégias:

- **Varredura por latitude (`sweep`):** ordena o grupo pela latitude e para de procurar quando a diferença já corresponde a mais de 20 metros. Uma diferença maior que essa, só na latitude, já impede um encontro. É a opção usada nos datasets fornecidos, que têm de 10 a 120 pessoas por horário.
- **Grade espacial (`grid`):** converte as coordenadas para pontos em uma esfera e os distribui em cubos de 20 metros. Cada ponto consulta sua célula e as 26 vizinhas. Dois pontos a menos de 20 metros na superfície também estão a menos de 20 metros em linha reta, então precisam estar nessas células. Isso funciona inclusive nos polos e na passagem entre longitudes -180 e 180.

O modo padrão, `auto`, usa a varredura até 256 posições por timestamp e a grade acima disso. Esse limite evita a montagem da grade em grupos pequenos. As opções podem ser forçadas com `--algorithm sweep` ou `--algorithm grid`.

Os filtros só escolhem os candidatos. A decisão final sempre usa Haversine, sem arredondar a distância: **20 metros exatos não contam como encontro**. Cada par é comparado uma vez, e seus IDs são gravados em ordem crescente. O mesmo par em outro timestamp gera outro registro.

Se `m` é o tamanho do grupo e `c` a quantidade de candidatos, a varredura custa `O(m log m + c)` e a grade custa `O(m + c)` esperado. Ambas podem chegar ao caso quadrático em grupos densos. A memória é `O(m)` mais os buffers de leitura e escrita.

Escolhi essa abordagem porque o arquivo pode ser grande, mas o grupo de cada horário é pequeno. No dataset 7, por exemplo, são feitos 6.843 cálculos de Haversine para 12 milhões de posições, em vez de comparar os 714 milhões de pares possíveis entre pessoas do mesmo horário.

## Tipos de encontro

Como só pode haver um registro por par e timestamp, a classificação segue esta prioridade:

1. `protetiva`: um dos envolvidos tem `medidaProtetiva=true` e o ID do outro aparece em sua lista de restrições.
2. `faccao`: os dois têm a mesma facção preenchida.
3. `generico`: os demais pares próximos.

Facções vazias não contam como uma facção em comum. A restrição protetiva é consultada nos dois sentidos.

Interpretei “quaisquer dois monitorados” como todos os IDs da entrada, incluindo vítimas. Por isso, um par próximo sem vínculo específico entra como genérico mesmo se envolver uma vítima. A regra está concentrada em `encounterType`, no arquivo `src/detector.js`.

## Validação da entrada

O leitor aceita LF, CRLF, BOM UTF-8, campos entre aspas e a última linha sem quebra de linha. Valida o cabeçalho, os sete campos, IDs inteiros seguros, datas, booleanos e os limites das coordenadas. Linhas vazias são ignoradas. O limite de tamanho por linha é 1 MiB.

Linhas repetidas para o mesmo ID e timestamp são descartadas quando os dados coincidem. Se as posições ou os metadados forem diferentes, o arquivo é rejeitado. A saída só substitui o arquivo anterior depois de terminar com sucesso.

O modo padrão rejeita registros inválidos. Para aproveitar um arquivo com a última linha cortada, existe `--allow-truncated-tail`, também usado por `npm run generate`. Essa opção só ignora uma última linha sem newline e com menos de sete campos. Quando isso acontece, o relatório marca o resultado como parcial. Os sete arquivos atuais foram processados em modo estrito, sem descartar linhas incompletas.

## Resultados

| Dataset | Posições | Encontros |
| --- | ---: | ---: |
| 1 | 5.000 | 4 |
| 2 | 25.000 | 6 |
| 3 | 100.000 | 10 |
| 4 | 400.020 | 15 |
| 5 | 1.000.000 | 21 |
| 6 | 8.000.000 | 27 |
| 7 | 12.000.000 | 35 |
| Total | 21.530.020 | 118 |

Todos os arquivos foram processados sem erros. Os resultados estão em `outputs/dataset1.json` até `outputs/dataset7.json`. Ao executar o programa, também é gerado `outputs/report.json`, com as contagens, os tempos e o status de cada execução. Esse relatório não acompanha o ZIP de entrega.

## Testes e desempenho

Os testes cobrem o limite de distância, os tipos de encontro, timestamps diferentes, duplicatas, dados inválidos, arquivos truncados, leitura entre blocos e execução da CLI. Também comparam as duas estratégias com força bruta em 16 amostras de 350 posições. Essa referência calcula a distância por vetores, sem reutilizar Haversine ou os filtros do detector.

Para medir o desempenho:

```sh
npm run benchmark
```

São três execuções por arquivo, cada uma em um processo novo. O tempo inclui leitura, validação, detecção e escrita, mas não o início do processo Node. O cache do sistema operacional não é limpo. O comando gera `outputs/benchmark.json` com o ambiente, as amostras, a média, a mediana e o pico de memória RSS. Os relatórios de benchmark não acompanham o ZIP.

Na última medição, com os sete arquivos atuais, a soma dos tempos médios foi de **47,935 segundos**, em Node.js 18.20.6 no Ubuntu/WSL2 (Intel Core i7-1360P). Os resultados foram iguais nas três execuções de cada arquivo.

O benchmark rejeita entradas inválidas e compara os resultados das repetições com os JSONs já gerados. Para medir outro algoritmo ou um arquivo específico:

```sh
npm run benchmark -- --input inputs/dataset7.txt --algorithm grid --runs 3 --output outputs/benchmark-grid.json
```

## Organização e entrega

- `src/`: leitura, validação, detecção, cálculo de distância e CLI.
- `test/`: testes com `node:test`.
- `scripts/`: verificação dos resultados e benchmark.
- `outputs/`: sete JSONs gerados pelo algoritmo.
- `requirements.txt`: enunciado original.
