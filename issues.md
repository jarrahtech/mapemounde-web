# Issues

* largest mass star is not primary! http://127.0.0.1:5173/aow.html?seed=1371171021723878&earthLike=false 
* weird http://127.0.0.1:5173/aow.html?seed=324846899048360&earthLike=false 
* small gasgiants in 2300ad seeds: 32, 6, 27, 37. Every flagged body has atmosphere: "Massive", so the pattern looks like the world type following the
  atmosphere roll regardless of size. Two side observations on seed 32 planet 42 you may also want to look at:
  its atmosphericPressure is 0.28 atm despite the Massive atmosphere, and that system has planets at 490 au and
  882 au.
* AoW: dense GasGiants. Six of 178 across seeds 1 to 40, densest first:
  ┌─────────────────────┬───────────┬───────────────────────┬─────────┬──────────┐
  │       request       │ planet id │        density        │ radius  │   mass   │
  ├─────────────────────┼───────────┼───────────────────────┼─────────┼──────────┤
  │ /api/v1/aow?seed=32 │ 13        │ 1.18 D🜨 (6,525 kg/m³) │ 11.6 R⊕ │ 1,836 M⊕ │
  ├─────────────────────┼───────────┼───────────────────────┼─────────┼──────────┤
  │ /api/v1/aow?seed=10 │ 28        │ 1.02 D🜨 (5,606 kg/m³) │ 11.7 R⊕ │ 1,629 M⊕ │
  ├─────────────────────┼───────────┼───────────────────────┼─────────┼──────────┤
  │ /api/v1/aow?seed=11 │ 3         │ 0.89 D🜨 (4,892 kg/m³) │ 11.8 R⊕ │ 1,463 M⊕ │
  └─────────────────────┴───────────┴───────────────────────┴─────────┴──────────┘
  I now think these are correct rather than errors, and I should retract my earlier "rock-like" remark. All six
  are super-Jupiters of four to six Jupiter masses at about one Jupiter radius. Above roughly one Jupiter mass,
  added mass compresses the body instead of enlarging it, so a 5.8 M♃ planet at 1.03 R♃ really does come out
  near 6,500 kg/m³. The mass, radius and density in the payload are also internally consistent. Worth a glance
  at the book's table, but I would not expect a bug.
* Rings are very common in ad2300, about five per system, and 15 of them in 40
  seeds sit round bodies under 3,000 km. Examples: seed 4 planet 23, an IceBall of 500 km with a ring; seed 19
  planet 3, a Rock of 500 km; seed 26, where six of seven planets are ringed. Rings round bodies that small are
  not impossible, but the frequency may be worth a look. The Desert worlds at 73 to 114 K are not an issue: the
  book's own word calls them VeryCold, so Desert there means dry, not hot.
