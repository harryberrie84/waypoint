// A broad, searchable emoji set for page icons and the callout block. Grouped by
// category with a few keywords each for search. Curated (not generated from code
// point ranges) so there are no unassigned "tofu" boxes.

export interface EmojiDef {
  e: string;
  n: string; // space-separated keywords for search
}
export interface EmojiGroup {
  label: string;
  items: EmojiDef[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: 'Smileys',
    items: [
      { e: '😀', n: 'grin smile happy' }, { e: '😃', n: 'smile happy joy' }, { e: '😄', n: 'happy laugh' },
      { e: '😁', n: 'beam grin' }, { e: '😆', n: 'laugh haha' }, { e: '😅', n: 'sweat laugh nervous' },
      { e: '🤣', n: 'rofl laugh' }, { e: '😂', n: 'joy tears laugh' }, { e: '🙂', n: 'slight smile' },
      { e: '🙃', n: 'upside down silly' }, { e: '😉', n: 'wink' }, { e: '😊', n: 'blush smile happy' },
      { e: '😇', n: 'angel halo innocent' }, { e: '🥰', n: 'love hearts adore' }, { e: '😍', n: 'love heart eyes' },
      { e: '🤩', n: 'star struck wow' }, { e: '😘', n: 'kiss blow' }, { e: '😋', n: 'yum tasty tongue' },
      { e: '😛', n: 'tongue cheeky' }, { e: '🤪', n: 'zany wacky crazy' }, { e: '🤨', n: 'raised eyebrow skeptic' },
      { e: '🧐', n: 'monocle inspect' }, { e: '🤓', n: 'nerd geek glasses' }, { e: '😎', n: 'cool sunglasses' },
      { e: '🥳', n: 'party celebrate' }, { e: '😏', n: 'smirk sly' }, { e: '😒', n: 'unamused meh' },
      { e: '😞', n: 'sad disappointed' }, { e: '😔', n: 'pensive sad' }, { e: '😟', n: 'worried' },
      { e: '😕', n: 'confused' }, { e: '🙁', n: 'frown sad' }, { e: '😣', n: 'persevere struggle' },
      { e: '😖', n: 'confounded' }, { e: '😫', n: 'tired weary' }, { e: '😩', n: 'weary tired' },
      { e: '🥺', n: 'pleading puppy' }, { e: '😢', n: 'cry sad tear' }, { e: '😭', n: 'sob cry bawl' },
      { e: '😤', n: 'huff steam' }, { e: '😠', n: 'angry mad' }, { e: '😡', n: 'rage furious' },
      { e: '🤬', n: 'swear curse' }, { e: '🤯', n: 'mind blown' }, { e: '😳', n: 'flushed embarrassed' },
      { e: '🥵', n: 'hot heat' }, { e: '🥶', n: 'cold freeze' }, { e: '😱', n: 'scream fear' },
      { e: '😨', n: 'fear scared' }, { e: '😰', n: 'anxious cold sweat' }, { e: '😴', n: 'sleep zzz' },
      { e: '🤤', n: 'drool' }, { e: '😪', n: 'sleepy' }, { e: '🤔', n: 'think hmm' },
      { e: '🤫', n: 'shush quiet' }, { e: '🤭', n: 'giggle oops' }, { e: '🥱', n: 'yawn bored' },
      { e: '😬', n: 'grimace awkward' }, { e: '🙄', n: 'eye roll' }, { e: '😮', n: 'wow open mouth' },
      { e: '😯', n: 'surprise hushed' }, { e: '😶', n: 'no mouth speechless' }, { e: '🤐', n: 'zip lips secret' },
      { e: '🤧', n: 'sneeze sick' }, { e: '🤒', n: 'sick thermometer' }, { e: '🤕', n: 'hurt bandage' },
      { e: '🤢', n: 'nausea sick' }, { e: '🤮', n: 'vomit sick' }, { e: '😷', n: 'mask sick' },
      { e: '🤥', n: 'lie pinocchio' }, { e: '😈', n: 'devil mischief' }, { e: '👿', n: 'imp angry devil' },
      { e: '💀', n: 'skull dead' }, { e: '👻', n: 'ghost boo' }, { e: '👽', n: 'alien ufo' },
      { e: '🤖', n: 'robot bot' }, { e: '🤡', n: 'clown' }, { e: '💩', n: 'poop' },
    ],
  },
  {
    label: 'People',
    items: [
      { e: '👋', n: 'wave hello hi' }, { e: '🤚', n: 'raised hand' }, { e: '✋', n: 'hand stop' },
      { e: '👌', n: 'ok perfect' }, { e: '🤏', n: 'pinch small' }, { e: '✌️', n: 'peace victory' },
      { e: '🤞', n: 'crossed fingers luck' }, { e: '🤟', n: 'love you' }, { e: '🤘', n: 'rock horns' },
      { e: '👈', n: 'point left' }, { e: '👉', n: 'point right' }, { e: '👆', n: 'point up' },
      { e: '👇', n: 'point down' }, { e: '👍', n: 'thumbs up like yes' }, { e: '👎', n: 'thumbs down no' },
      { e: '✊', n: 'fist' }, { e: '👊', n: 'punch fist bump' }, { e: '👏', n: 'clap applause' },
      { e: '🙌', n: 'raise hands praise' }, { e: '🙏', n: 'pray thanks please' }, { e: '🤝', n: 'handshake deal' },
      { e: '💪', n: 'muscle strong' }, { e: '🦾', n: 'mechanical arm' }, { e: '✍️', n: 'write hand' },
      { e: '👀', n: 'eyes look' }, { e: '🧠', n: 'brain mind' }, { e: '🫀', n: 'heart organ' },
      { e: '👶', n: 'baby' }, { e: '🧒', n: 'child' }, { e: '👦', n: 'boy' }, { e: '👧', n: 'girl' },
      { e: '🧑', n: 'person adult' }, { e: '👨', n: 'man' }, { e: '👩', n: 'woman' },
      { e: '🧓', n: 'old elder' }, { e: '👴', n: 'old man grandpa' }, { e: '👵', n: 'old woman grandma' },
      { e: '🧑‍💻', n: 'developer coder tech' }, { e: '🧑‍🍳', n: 'chef cook' }, { e: '🧑‍🎓', n: 'student graduate' },
      { e: '🧑‍🏫', n: 'teacher' }, { e: '🧑‍⚕️', n: 'doctor nurse health' }, { e: '🕵️', n: 'detective spy' },
      { e: '💃', n: 'dance' }, { e: '🕺', n: 'dance man' }, { e: '🚶', n: 'walk' }, { e: '🏃', n: 'run' },
      { e: '🧘', n: 'yoga meditate calm' }, { e: '👪', n: 'family' }, { e: '❤️‍🔥', n: 'heart fire passion' },
    ],
  },
  {
    label: 'Animals',
    items: [
      { e: '🐶', n: 'dog puppy' }, { e: '🐱', n: 'cat kitten' }, { e: '🐭', n: 'mouse' }, { e: '🐹', n: 'hamster' },
      { e: '🐰', n: 'rabbit bunny' }, { e: '🦊', n: 'fox' }, { e: '🐻', n: 'bear' }, { e: '🐼', n: 'panda' },
      { e: '🐨', n: 'koala' }, { e: '🐯', n: 'tiger' }, { e: '🦁', n: 'lion' }, { e: '🐮', n: 'cow' },
      { e: '🐷', n: 'pig' }, { e: '🐸', n: 'frog' }, { e: '🐵', n: 'monkey' }, { e: '🐔', n: 'chicken' },
      { e: '🐧', n: 'penguin' }, { e: '🐦', n: 'bird' }, { e: '🦆', n: 'duck' }, { e: '🦉', n: 'owl' },
      { e: '🦄', n: 'unicorn' }, { e: '🐝', n: 'bee' }, { e: '🦋', n: 'butterfly' }, { e: '🐌', n: 'snail' },
      { e: '🐞', n: 'ladybug' }, { e: '🐢', n: 'turtle' }, { e: '🐍', n: 'snake' }, { e: '🐙', n: 'octopus' },
      { e: '🦑', n: 'squid' }, { e: '🦐', n: 'shrimp' }, { e: '🐠', n: 'fish tropical' }, { e: '🐬', n: 'dolphin' },
      { e: '🐳', n: 'whale' }, { e: '🦈', n: 'shark' }, { e: '🐊', n: 'crocodile' }, { e: '🐘', n: 'elephant' },
      { e: '🦒', n: 'giraffe' }, { e: '🦓', n: 'zebra' }, { e: '🐴', n: 'horse' }, { e: '🐑', n: 'sheep' },
      { e: '🐐', n: 'goat' }, { e: '🦌', n: 'deer' }, { e: '🐕', n: 'dog' }, { e: '🐈', n: 'cat' },
      { e: '🌵', n: 'cactus' }, { e: '🌲', n: 'tree evergreen' }, { e: '🌳', n: 'tree' }, { e: '🌴', n: 'palm tree' },
      { e: '🌱', n: 'seedling sprout' }, { e: '🌿', n: 'herb leaf' }, { e: '🍀', n: 'clover luck' }, { e: '🍁', n: 'maple leaf' },
      { e: '🌸', n: 'blossom flower' }, { e: '🌺', n: 'hibiscus flower' }, { e: '🌻', n: 'sunflower' }, { e: '🌹', n: 'rose' },
      { e: '🌷', n: 'tulip' }, { e: '🌼', n: 'daisy flower' }, { e: '💐', n: 'bouquet flowers' },
    ],
  },
  {
    label: 'Food',
    items: [
      { e: '🍎', n: 'apple' }, { e: '🍐', n: 'pear' }, { e: '🍊', n: 'orange' }, { e: '🍋', n: 'lemon' },
      { e: '🍌', n: 'banana' }, { e: '🍉', n: 'watermelon' }, { e: '🍇', n: 'grapes' }, { e: '🍓', n: 'strawberry' },
      { e: '🫐', n: 'blueberry' }, { e: '🍒', n: 'cherry' }, { e: '🍑', n: 'peach' }, { e: '🥭', n: 'mango' },
      { e: '🍍', n: 'pineapple' }, { e: '🥥', n: 'coconut' }, { e: '🥝', n: 'kiwi' }, { e: '🍅', n: 'tomato' },
      { e: '🥑', n: 'avocado' }, { e: '🍆', n: 'eggplant' }, { e: '🥕', n: 'carrot' }, { e: '🌽', n: 'corn' },
      { e: '🌶️', n: 'chili pepper spicy' }, { e: '🥦', n: 'broccoli' }, { e: '🧄', n: 'garlic' }, { e: '🧅', n: 'onion' },
      { e: '🥔', n: 'potato' }, { e: '🍞', n: 'bread' }, { e: '🥐', n: 'croissant' }, { e: '🥨', n: 'pretzel' },
      { e: '🧀', n: 'cheese' }, { e: '🥚', n: 'egg' }, { e: '🍳', n: 'fried egg cooking' }, { e: '🥞', n: 'pancakes' },
      { e: '🧇', n: 'waffle' }, { e: '🥓', n: 'bacon' }, { e: '🍔', n: 'burger' }, { e: '🍟', n: 'fries' },
      { e: '🍕', n: 'pizza' }, { e: '🌭', n: 'hot dog' }, { e: '🌮', n: 'taco' }, { e: '🌯', n: 'burrito' },
      { e: '🍜', n: 'ramen noodles' }, { e: '🍝', n: 'pasta spaghetti' }, { e: '🍣', n: 'sushi' }, { e: '🍱', n: 'bento' },
      { e: '🍙', n: 'rice ball onigiri' }, { e: '🍚', n: 'rice' }, { e: '🍤', n: 'tempura shrimp' }, { e: '🥟', n: 'dumpling' },
      { e: '🍢', n: 'oden skewer' }, { e: '🍡', n: 'dango' }, { e: '🍦', n: 'ice cream' }, { e: '🍰', n: 'cake slice' },
      { e: '🎂', n: 'birthday cake' }, { e: '🍪', n: 'cookie' }, { e: '🍩', n: 'donut' }, { e: '🍫', n: 'chocolate' },
      { e: '🍬', n: 'candy' }, { e: '🍿', n: 'popcorn' }, { e: '☕', n: 'coffee tea' }, { e: '🍵', n: 'tea green' },
      { e: '🍺', n: 'beer' }, { e: '🍻', n: 'beers cheers' }, { e: '🍷', n: 'wine' }, { e: '🍸', n: 'cocktail' },
      { e: '🥂', n: 'champagne toast' }, { e: '🧊', n: 'ice cube' }, { e: '🥤', n: 'soda drink' },
    ],
  },
  {
    label: 'Travel',
    items: [
      { e: '✈️', n: 'plane flight travel' }, { e: '🚆', n: 'train' }, { e: '🚄', n: 'bullet train shinkansen' },
      { e: '🚅', n: 'train fast' }, { e: '🚇', n: 'metro subway' }, { e: '🚌', n: 'bus' }, { e: '🚕', n: 'taxi' },
      { e: '🚗', n: 'car' }, { e: '🚙', n: 'suv car' }, { e: '🏍️', n: 'motorcycle' }, { e: '🚲', n: 'bike bicycle' },
      { e: '🛴', n: 'scooter' }, { e: '🚀', n: 'rocket launch' }, { e: '🛸', n: 'ufo' }, { e: '🚁', n: 'helicopter' },
      { e: '⛵', n: 'sailboat' }, { e: '🚢', n: 'ship cruise' }, { e: '⚓', n: 'anchor' }, { e: '🗺️', n: 'map world' },
      { e: '🧭', n: 'compass navigate' }, { e: '📍', n: 'pin location' }, { e: '🗾', n: 'japan map' }, { e: '🗻', n: 'fuji mountain' },
      { e: '⛰️', n: 'mountain' }, { e: '🏔️', n: 'snow mountain' }, { e: '🌋', n: 'volcano' }, { e: '🏕️', n: 'camping tent' },
      { e: '🏖️', n: 'beach' }, { e: '🏝️', n: 'island' }, { e: '🏜️', n: 'desert' }, { e: '🏞️', n: 'park nature' },
      { e: '🏟️', n: 'stadium' }, { e: '🏛️', n: 'museum classical building' }, { e: '🏰', n: 'castle' }, { e: '🗼', n: 'tower' },
      { e: '🗽', n: 'statue liberty' }, { e: '⛩️', n: 'shrine torii japan' }, { e: '🏯', n: 'japanese castle' }, { e: '🏠', n: 'house home' },
      { e: '🏡', n: 'house garden home' }, { e: '🏢', n: 'office building' }, { e: '🏨', n: 'hotel' }, { e: '🏪', n: 'convenience store' },
      { e: '🏫', n: 'school' }, { e: '🏥', n: 'hospital' }, { e: '🌃', n: 'night city' }, { e: '🌉', n: 'bridge night' },
      { e: '🌁', n: 'foggy city' }, { e: '🎑', n: 'moon viewing' }, { e: '🗿', n: 'moai statue' },
    ],
  },
  {
    label: 'Activities',
    items: [
      { e: '⚽', n: 'soccer football' }, { e: '🏀', n: 'basketball' }, { e: '🏈', n: 'football american' }, { e: '⚾', n: 'baseball' },
      { e: '🎾', n: 'tennis' }, { e: '🏐', n: 'volleyball' }, { e: '🏉', n: 'rugby' }, { e: '🎱', n: 'pool 8 ball' },
      { e: '🏓', n: 'ping pong table tennis' }, { e: '🏸', n: 'badminton' }, { e: '🥅', n: 'goal' }, { e: '⛳', n: 'golf' },
      { e: '🏹', n: 'archery bow' }, { e: '🎣', n: 'fishing' }, { e: '🥊', n: 'boxing' }, { e: '🥋', n: 'martial arts' },
      { e: '⛸️', n: 'skate ice' }, { e: '🎿', n: 'ski' }, { e: '🏂', n: 'snowboard' }, { e: '🏄', n: 'surf' },
      { e: '🏊', n: 'swim' }, { e: '🚴', n: 'cycling' }, { e: '🧗', n: 'climbing' }, { e: '🏆', n: 'trophy win' },
      { e: '🥇', n: 'gold medal first' }, { e: '🎖️', n: 'medal honor' }, { e: '🎯', n: 'target dart goal' }, { e: '🎲', n: 'dice game' },
      { e: '🎮', n: 'game controller' }, { e: '🕹️', n: 'joystick arcade' }, { e: '🎰', n: 'slot machine' }, { e: '🎨', n: 'art paint' },
      { e: '🎭', n: 'theater drama' }, { e: '🎬', n: 'movie film clapper' }, { e: '🎤', n: 'mic sing' }, { e: '🎧', n: 'headphones music' },
      { e: '🎵', n: 'music note' }, { e: '🎶', n: 'music notes' }, { e: '🎸', n: 'guitar' }, { e: '🎹', n: 'piano keyboard' },
      { e: '🥁', n: 'drums' }, { e: '🎺', n: 'trumpet' }, { e: '🎻', n: 'violin' }, { e: '🎲', n: 'dnd dice' },
      { e: '🎉', n: 'party celebrate tada' }, { e: '🎊', n: 'confetti party' }, { e: '🎈', n: 'balloon' }, { e: '🎁', n: 'gift present' },
    ],
  },
  {
    label: 'Objects',
    items: [
      { e: '📱', n: 'phone mobile' }, { e: '💻', n: 'laptop computer' }, { e: '🖥️', n: 'desktop computer' }, { e: '⌨️', n: 'keyboard' },
      { e: '🖱️', n: 'mouse' }, { e: '🖨️', n: 'printer' }, { e: '💾', n: 'save floppy disk' }, { e: '💿', n: 'disc cd' },
      { e: '📷', n: 'camera photo' }, { e: '📸', n: 'camera flash' }, { e: '🎥', n: 'video camera' }, { e: '📺', n: 'tv' },
      { e: '🔋', n: 'battery' }, { e: '🔌', n: 'plug power' }, { e: '💡', n: 'idea bulb light' }, { e: '🔦', n: 'flashlight torch' },
      { e: '🕯️', n: 'candle' }, { e: '📔', n: 'notebook' }, { e: '📒', n: 'ledger notebook' }, { e: '📓', n: 'notebook' },
      { e: '📕', n: 'book closed' }, { e: '📗', n: 'book green' }, { e: '📘', n: 'book blue' }, { e: '📙', n: 'book orange' },
      { e: '📚', n: 'books library' }, { e: '📖', n: 'open book read' }, { e: '🔖', n: 'bookmark' }, { e: '📝', n: 'note memo write' },
      { e: '✏️', n: 'pencil write' }, { e: '✒️', n: 'pen' }, { e: '🖊️', n: 'pen' }, { e: '🖌️', n: 'paintbrush' },
      { e: '📌', n: 'pin pushpin' }, { e: '📎', n: 'paperclip' }, { e: '✂️', n: 'scissors cut' }, { e: '📐', n: 'ruler triangle' },
      { e: '📏', n: 'ruler' }, { e: '📅', n: 'calendar date' }, { e: '📆', n: 'calendar' }, { e: '🗓️', n: 'calendar spiral' },
      { e: '📋', n: 'clipboard' }, { e: '📁', n: 'folder' }, { e: '📂', n: 'folder open' }, { e: '🗂️', n: 'dividers files' },
      { e: '📊', n: 'bar chart graph' }, { e: '📈', n: 'chart up trend' }, { e: '📉', n: 'chart down' }, { e: '💰', n: 'money bag' },
      { e: '💵', n: 'dollar money cash' }, { e: '💴', n: 'yen money' }, { e: '💶', n: 'euro money' }, { e: '💳', n: 'card credit' },
      { e: '💎', n: 'gem diamond' }, { e: '⚖️', n: 'scales law balance' }, { e: '🔧', n: 'wrench tool' }, { e: '🔨', n: 'hammer' },
      { e: '🛠️', n: 'tools' }, { e: '⚙️', n: 'gear settings' }, { e: '🔑', n: 'key' }, { e: '🔒', n: 'lock secure' },
      { e: '🔓', n: 'unlock open' }, { e: '🔔', n: 'bell notify' }, { e: '📢', n: 'announce loudspeaker' }, { e: '💬', n: 'speech chat comment' },
      { e: '💭', n: 'thought bubble' }, { e: '🗯️', n: 'anger speech' }, { e: '🧪', n: 'test tube science' }, { e: '🔬', n: 'microscope' },
      { e: '🔭', n: 'telescope' }, { e: '🧬', n: 'dna' }, { e: '💊', n: 'pill medicine' }, { e: '🩺', n: 'stethoscope health' },
      { e: '🧹', n: 'broom clean' }, { e: '🧺', n: 'basket laundry' }, { e: '🛒', n: 'cart shopping' }, { e: '🎒', n: 'backpack bag' },
    ],
  },
  {
    label: 'Symbols',
    items: [
      { e: '❤️', n: 'heart love red' }, { e: '🧡', n: 'heart orange' }, { e: '💛', n: 'heart yellow' }, { e: '💚', n: 'heart green' },
      { e: '💙', n: 'heart blue' }, { e: '💜', n: 'heart purple' }, { e: '🖤', n: 'heart black' }, { e: '🤍', n: 'heart white' },
      { e: '💔', n: 'broken heart' }, { e: '💖', n: 'sparkle heart' }, { e: '⭐', n: 'star' }, { e: '🌟', n: 'glow star' },
      { e: '✨', n: 'sparkles' }, { e: '⚡', n: 'lightning bolt fast' }, { e: '🔥', n: 'fire flame hot' }, { e: '💥', n: 'boom explosion' },
      { e: '☀️', n: 'sun sunny' }, { e: '🌙', n: 'moon' }, { e: '☁️', n: 'cloud' }, { e: '🌧️', n: 'rain' },
      { e: '⛈️', n: 'storm thunder' }, { e: '🌈', n: 'rainbow' }, { e: '❄️', n: 'snowflake cold' }, { e: '💧', n: 'drop water' },
      { e: '🌊', n: 'wave ocean' }, { e: '✅', n: 'check done yes' }, { e: '☑️', n: 'checkbox' }, { e: '✔️', n: 'check tick' },
      { e: '❌', n: 'cross no wrong' }, { e: '❎', n: 'cross mark' }, { e: '➕', n: 'plus add' }, { e: '➖', n: 'minus' },
      { e: '❓', n: 'question' }, { e: '❗', n: 'exclamation important' }, { e: '⚠️', n: 'warning caution' }, { e: '🚫', n: 'no forbidden' },
      { e: '💯', n: 'hundred perfect' }, { e: '🔆', n: 'bright' }, { e: '🔱', n: 'trident' }, { e: '♻️', n: 'recycle' },
      { e: '🔰', n: 'beginner badge' }, { e: '⭕', n: 'circle' }, { e: '🟢', n: 'green circle' }, { e: '🔴', n: 'red circle' },
      { e: '🟡', n: 'yellow circle' }, { e: '🔵', n: 'blue circle' }, { e: '🟣', n: 'purple circle' }, { e: '⚫', n: 'black circle' },
      { e: '⚪', n: 'white circle' }, { e: '🟥', n: 'red square' }, { e: '🟩', n: 'green square' }, { e: '🟦', n: 'blue square' },
      { e: '🔶', n: 'orange diamond' }, { e: '🔷', n: 'blue diamond' }, { e: '🏁', n: 'finish flag race' }, { e: '🚩', n: 'flag' },
      { e: '🎌', n: 'crossed flags japan' }, { e: '🏳️', n: 'white flag' }, { e: '🏴', n: 'black flag' }, { e: '🌐', n: 'globe web' },
      { e: '♾️', n: 'infinity' }, { e: '🆕', n: 'new' }, { e: '🆗', n: 'ok' }, { e: '🆙', n: 'up' }, { e: '🔝', n: 'top' },
      { e: '#️⃣', n: 'hash number' }, { e: '🔢', n: 'numbers' }, { e: '🔤', n: 'letters abc' }, { e: '🕐', n: 'clock time' },
    ],
  },
  {
    label: 'Flags',
    items: [
      { e: '🇯🇵', n: 'japan japanese nippon flag jp' }, { e: '🇨🇳', n: 'china chinese prc flag cn' }, { e: '🇸🇪', n: 'sweden swedish sverige flag se' },
      { e: '🇰🇷', n: 'south korea korean flag kr' }, { e: '🇰🇵', n: 'north korea flag kp' }, { e: '🇹🇼', n: 'taiwan taiwanese flag tw' },
      { e: '🇭🇰', n: 'hong kong flag hk' }, { e: '🇹🇭', n: 'thailand thai flag th' }, { e: '🇻🇳', n: 'vietnam vietnamese flag vn' },
      { e: '🇮🇩', n: 'indonesia indonesian flag id' }, { e: '🇲🇾', n: 'malaysia malaysian flag my' }, { e: '🇸🇬', n: 'singapore flag sg' },
      { e: '🇵🇭', n: 'philippines filipino flag ph' }, { e: '🇮🇳', n: 'india indian flag in' }, { e: '🇺🇸', n: 'usa america american united states flag us' },
      { e: '🇨🇦', n: 'canada canadian flag ca' }, { e: '🇲🇽', n: 'mexico mexican flag mx' }, { e: '🇬🇧', n: 'uk britain british england united kingdom flag gb' },
      { e: '🇮🇪', n: 'ireland irish flag ie' }, { e: '🇫🇷', n: 'france french flag fr' }, { e: '🇩🇪', n: 'germany german flag de' },
      { e: '🇮🇹', n: 'italy italian flag it' }, { e: '🇪🇸', n: 'spain spanish flag es' }, { e: '🇵🇹', n: 'portugal portuguese flag pt' },
      { e: '🇳🇱', n: 'netherlands dutch holland flag nl' }, { e: '🇧🇪', n: 'belgium belgian flag be' }, { e: '🇨🇭', n: 'switzerland swiss flag ch' },
      { e: '🇦🇹', n: 'austria austrian flag at' }, { e: '🇳🇴', n: 'norway norwegian flag no' }, { e: '🇩🇰', n: 'denmark danish flag dk' },
      { e: '🇫🇮', n: 'finland finnish flag fi' }, { e: '🇮🇸', n: 'iceland icelandic flag is' }, { e: '🇵🇱', n: 'poland polish flag pl' },
      { e: '🇨🇿', n: 'czech czechia flag cz' }, { e: '🇬🇷', n: 'greece greek flag gr' }, { e: '🇷🇺', n: 'russia russian flag ru' },
      { e: '🇺🇦', n: 'ukraine ukrainian flag ua' }, { e: '🇹🇷', n: 'turkey turkish flag tr' }, { e: '🇮🇱', n: 'israel israeli flag il' },
      { e: '🇸🇦', n: 'saudi arabia flag sa' }, { e: '🇦🇪', n: 'uae emirates dubai flag ae' }, { e: '🇪🇬', n: 'egypt egyptian flag eg' },
      { e: '🇲🇦', n: 'morocco moroccan flag ma' }, { e: '🇿🇦', n: 'south africa flag za' }, { e: '🇳🇬', n: 'nigeria nigerian flag ng' },
      { e: '🇰🇪', n: 'kenya kenyan flag ke' }, { e: '🇧🇷', n: 'brazil brazilian flag br' }, { e: '🇦🇷', n: 'argentina argentine flag ar' },
      { e: '🇨🇱', n: 'chile chilean flag cl' }, { e: '🇨🇴', n: 'colombia colombian flag co' }, { e: '🇵🇪', n: 'peru peruvian flag pe' },
      { e: '🇦🇺', n: 'australia australian flag au' }, { e: '🇳🇿', n: 'new zealand flag nz' }, { e: '🇪🇺', n: 'european union europe eu flag' },
      { e: '🏳️‍🌈', n: 'pride rainbow lgbt flag' }, { e: '🏴‍☠️', n: 'pirate skull flag' }, { e: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', n: 'scotland scottish flag' },
    ],
  },
];

// Flat list for search.
const ALL: EmojiDef[] = EMOJI_GROUPS.flatMap((g) => g.items);

export function searchEmoji(query: string): EmojiDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Rank exact keyword matches first, then word-start, then any substring, so a
  // search like "japan" or "swedish" surfaces the obvious hit at the top.
  const scored: { d: EmojiDef; s: number }[] = [];
  for (const d of ALL) {
    if (d.e === query) {
      scored.push({ d, s: 100 });
      continue;
    }
    const words = d.n.split(' ');
    let s = -1;
    if (words.some((w) => w === q)) s = 60;
    else if (words.some((w) => w.startsWith(q))) s = 40;
    else if (d.n.includes(q)) s = 20;
    if (s >= 0) scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 80).map((x) => x.d);
}
