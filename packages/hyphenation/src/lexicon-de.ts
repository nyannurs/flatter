/**
 * Curated German morphology for the rule-based second opinion and for finding
 * main joints (Haupttrennstellen). The lists only decide preference (A vs B)
 * and the second opinion: a point is used only when the TeX patterns agree too,
 * so a missing or odd entry costs a hyphenation point, never correctness.
 *
 * Add stems in lower case, base form, without inflection.
 */

/** Separable and inseparable prefixes, and prepositions used as first parts. */
export const DE_PREFIXES: readonly string[] = `
ab an auf aus be bei dar durch ein ent emp er fort ge gegen her herab heran herauf heraus herein
hin hinab hinauf hinaus hinein hinter los miss mit nach neben ob über um un unter ur ver vor voran
vorbei weg wider wieder zer zu zurück zusammen voll in
`.trim().split(/\s+/);

/** Derivational suffixes: they stay part of their constituent (no joint). */
export const DE_SUFFIXES: readonly string[] = `
ung ungen heit heiten keit keiten schaft schaften lich ig isch bar sam los haft nis nisse tum ling
chen lein er erin erinnen el ler ner ier ieren iert ität ion ionen ation ist isten ismus ik
`.trim().split(/\s+/);

/** Inflection allowed at the very end of the word. */
export const DE_INFLECTIONS: readonly string[] = ['e', 'en', 'n', 's', 'es', 'er', 'ern', 'em', 'nen', 't', 'te', 'ten', 'st', 'et'];

/** Linking elements (Fugenelemente) between constituents. */
export const DE_FUGEN: readonly string[] = ['s', 'es', 'n', 'en', 'e', 'er', 'ens'];

/** Stems that can stand as constituents. Two-letter stems are listed explicitly. */
export const DE_STEMS: readonly string[] = `
ei
abend acht adel ader affe akt akte alarm alt amt angel angst antwort apfel arbeit arm art arzt ast atem
auge august auto axt bach backe bad bahn ball band bank bar bart bau bauch baum beere bein berg beruf
besen bett biene bier bild bio birne bitte blatt blau blech blei blick blitz blume blut boden bogen
bohne boot bord bote brand brei brief brille brot brücke bruder brunnen brust buch buche bude bund
burg büro busch butter chef chor dach dame dampf dank darm datum dauer daumen decke deich denk dicht
dichter dieb dienst ding dock dorf dorn draht drama dreh druck duft dunkel durst dusche ecke ehe ehre
eis eisen ende engel enkel ente erbe erb erde esel essen eule fach faden fahr fahrt fall falt falte
familie fang farbe fass faust feder fehl fehler feier feind feld fell fels fenster ferien fern fest
fett feuer fieber film filter finger fisch flach flamme flasche fleck fleisch fleiß flieg flug flur
fluss flut folge form fracht frage frau frei freund frieden frost frucht früh fuchs fuge fund funk
fuß futter gabe gang gans garten gas gast gebirge gefahr geist geld gelder gemüse genuss gerät gericht
gesetz gesicht gewalt gift gipfel glas glanz glaube gleis glied glocke glück gold gott grab grad graf
gras grenze griff grube grund gruppe gruß gunst gurt gut haar hafen hagel hahn haken halb hals halt
hand handel hang harz hase hass haupt haus haut heft heide heil heim heimat heiz held hell hemd herbst
herd herr herz heu hilfe himmel hirn hirsch hitze hobel hoch hof hoff höhe hohl holz honig horn hose
hotel huhn hund hunger hut hütte idee igel insel instinkt jagd jahr jäger joch jugend kabel kaffee
kahn kai kakao kalb kalk kamm kampf kanal kante kanzel kapelle kappe karte kartoffel käse kasse kasten
katze kauf keil keller kern kerze kessel kette kiefer kind kinder kino kirche kiste kitt klang klappe
klasse klee kleid klein klima klinge klingel klotz kloster knabe knall knie knochen knopf knoten koch
koffer kohle kolumne kompass könig kopf korb korn körper kost kraft kragen kram kran kranz kraut kreis
kreuz krieg krone kuchen kugel kuh kunde kunst kupfer kurs kurve kuss küste labor lack lage lager
lamm lampe land lang lärm last laub lauf laune laut leben leder leer lehr lehre lehrer leib leim
leine leinen leiter lese licht lied liebe linie link linse lippe liste loch lohn los luft lunge lust
macht magen mahl mal maler mann mantel mappe marke markt mauer maul maus meer mehl meister melde
mensch merk messe messer metall miete milch mineral minute mittag mittel mitte mode monat mond moor
moos mord morgen motor möwe mücke mühle müll mund münze musik muskel mut mutter nabel nacht nadel nagel
nah name narbe nase natur nebel neffe nest netz nichte norden not notiz null nummer nuss ober obst
ofen ohr öl onkel oper opfer orden ort osten oster ost pack paket papier park pass pause pech pelz
pfad pfahl pfand pfanne pfeffer pfeife pfeil pferd pflanze pflaster pflege pflicht pflug pförtner
pfund pilz plan platte platz pol polizei post pracht preis presse probe programm punkt puppe quelle
rad rahmen rand rang rasen rat raum rausch recht rede regal regel regen reich reif reife reihe reis
reise reiz reform rennen rest rettung richt richter riegel riese rind ring rinne risiko rock rohr
rolle rose ross rost rot rücken ruder ruf ruhe rumpf rund saal saat sache sack saft sage salz samen
sand sarg satz sauer schach schacht schaden schaf schale schall schalter scham schar schatten schatz
schau schaum scheibe schein schere schicht schiff schild schirm schlaf schlag schlamm schlange schloss
schluss schlüssel schmerz schmied schmuck schmutz schnee schnitt schrank schraube schreib schrei
schrift schritt schuh schuld schule schuppe schuss schutz schwamm schwan schwanz schwein schwelle
schwer schwester see seele segel seide seife seil seite sekt senf sessel sicht sieb sieg siegel
silber sinn sitz sitte sohle sohn sommer sonne sorge sorg spalte span spar spargel spaß speck speise
spiegel spiel spieß spinne spitze sport sprache spruch sprung spur staat stab stadt stahl stall
stamm stand stange star stärke stau staub steg stein stelle stell stempel stern steuer stich stiefel
stiel stier stift stil stimme stirn stock stoff stolz storch stoß strafe strahl strand straße strauch
strauß streich streifen streit strich strom stube stück stufe stuhl stunde sturm sucht süd süden
suppe tabelle tafel tag tal tank tanne tante tanz tasche tasse tat tau taube teich teig teil teller
tempel teppich text theater tier tinte tisch titel tochter tod ton topf tor torte tracht trank traum
treppe tritt trommel trost tuch tür turm tube uhr ufer umwelt unfall urlaub vater veilchen verb
vers vieh vogel volk vorhang waage wache wachs wachs waffe wagen wahl wahr wald wall wand wange ware
wärme wasser watte wechsel weg weide wein weise weiß welle welt werk wert wesen wespe westen wetter
wiese wild wille wind winkel winter wirt wissen witz woche wolke wolle wort wunde wunder wunsch würfel
wurm wurst wurzel wüste zahl zahn zange zaun zeche zehe zeichen zeit zeile zelt zettel zeug ziege
ziegel ziel zimmer zins zoll zone zucker zug zunge zwang zweck zweig zwerg zwiebel
achtung deut stimm schreib setz such fahr bind ordn zeich zieh hol halt bring kenn lern les leit
mach nehm sag schlaf sprech spring steh trag trenn wart wohn zahl zähl rechn red regier leist lös
wirk zeig zieh bild erfahr arbeits
flatter rhythmus treppe zeich rüch kaffee mühle rätsel mädchen konsonant vokal blumen deutsch kolumne
donau gesell becken wach über gegen unter hinter neben wider zusammen durch
wörter häuser bücher länder bilder lieder kleider felder völker männer wälder dächer
irgend etwas wes des
`.trim().split(/\s+/);
