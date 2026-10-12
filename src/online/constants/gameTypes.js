import { Crown, Diamond, Spade, Heart, AlertTriangle, Ban, Plus, TrendingUp } from 'lucide-react-online'

export const GAME_TYPES = [
  { code: 'K',  name: 'კინგი',      Icon: Crown,         description: 'არ აიღო გულის მეფე. −40 ქულა.',           color: '#edb2a0', totalUnits: 1,  pointPerUnit: -40 },
  { code: 'Q',  name: 'დამები',     Icon: Diamond,       description: 'არ აიღო დამები. −10 თითოზე.',             color: '#c6a6c5', totalUnits: 4,  pointPerUnit: -10 },
  { code: 'J',  name: 'ვალეტები',   Icon: Spade,         description: 'არ აიღო ვალეტები. −10 თითოზე.',           color: '#9cbdce', totalUnits: 4,  pointPerUnit: -10 },
  { code: 'H',  name: 'გულები',     Icon: Heart,         description: 'არ აიღო გულები. −5 თითოზე.',              color: '#ed9999', totalUnits: 8,  pointPerUnit: -5  },
  { code: 'L2', name: 'ბოლო ორი',   Icon: AlertTriangle, description: 'არ აიღო ბოლო ორი მინუსი. −20 თითოზე.',     color: '#d5b982', totalUnits: 2,  pointPerUnit: -20 },
  { code: 'T',  name: 'მინუსი',    Icon: Ban,           description: 'არ აიღო მინუსები. −4 თითოზე.',             color: '#c0b2a0', totalUnits: 10, pointPerUnit: -4  },
  { code: 'P1', name: 'პლიუსი 1',   Icon: Plus,          description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#a9c88b', totalUnits: 10, pointPerUnit: 8   },
  { code: 'P2', name: 'პლიუსი 2',   Icon: Plus,          description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#84c6b0', totalUnits: 10, pointPerUnit: 8   },
  { code: 'P3', name: 'პლიუსი 3',   Icon: TrendingUp,    description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#a5bbed', totalUnits: 10, pointPerUnit: 8   },
]

export const getGameType = (code) => GAME_TYPES.find(t => t.code === code)
