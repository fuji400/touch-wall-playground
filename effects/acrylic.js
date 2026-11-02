/* Acrylic Paint (2026-10-29, Billy's ask from two r/generative posts, "Acrylic paint" and "Solar prominence tondo"):
 * thick wet acrylic on a canvas, lit like real paint (impasto relief, gloss, brush grain along the stroke), kept crisp
 * the way poured acrylic keeps its cells: the paint is stored as PIGMENT WEIGHTS (six per texel), not RGB, and every
 * frame each cell leans a little toward its dominant pigment, so advection never turns the wall to mud and two pigments
 * meeting never invent a third colour. Natural mix is a seventh opt-in look: three primary pigments mix through a spectral LUT.
 * The original six looks keep their existing pigment separation. Six original LOOKS to switch in Tune (segmented "Look" buttons): Studio pour, Solar
 * prominence (a tondo: round canvas, hot pigments, paint erupting outward from the centre), Ocean, Neon, Earth, Pastel.
 *
 * BOTH sensors drive it (Billy: "make use of both sensors"):
 *   Kinect v2, the wall sensor:  kit.fingers = brushes. A tap dabs, a drag lays a stroke with ridges that follow the hand,
 *                                a hand held still pours (the blob grows and pushes paint outward). Each new hand gets the
 *                                next pigment of the look. WallBody (depth) = a palette knife: paint under and just outside
 *                                a body is squeezed outward along the outline (body.sdf gradient); a walking body smears
 *                                the paint along its walk (per person centroid velocity).
 *   Kinect v1, the room sensor:  kit.room(dt), read once per frame. Where the person stands (room.x / room.y) TILTS the
 *                                canvas, so wet paint runs that way; room motion stirs the paint (turbulence) and makes
 *                                it drip from the top edge (from the centre in the Solar look); anyone present keeps the
 *                                paint wet. Empty room + no wall contact for a while = the paint dries (stops moving, loses
 *                                gloss) and very slowly fades back to the ground so the next visitor starts fresh.
 *   Room off / no v1 / no registration: the piece still works with the wall hands alone.
 *
 * Engine: WebGL 2, EXT_color_buffer_float, half-resolution simulation (velocity RGBA16F: xy = creeping flow in window
 * units/s, zw = remembered stroke direction; textures are GL space, y up, window inputs flip y as they enter; paint = two RGBA16F targets written together (MRT): weights of pigments 0-3,
 * then weights 4-5 + thickness) and one full-resolution lighting pass. The flow is deliberately SLOW (a few px/s): paint
 * stays where the hand laid it and creeps, it is never launched. No audio, no network, no storage. Depth only via
 * kit.wantDepth(true) for the body stage.
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2, MAXB = 12, MAXP = 4, MAX_DRIPS = 4, MAX_HANDS = 4;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var valid = function (p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; };
  function hex(s) { var n = parseInt(s.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

  // ---------------------------------------------------------------- the looks (the "Look" choices knob)
  // pal: 6 pigments (the brush cycles through them) / ground: the bare canvas / tondo: round canvas / radial: outward flow from the centre
  // drift: ambient curl flow / swirl: slow global rotation / spread: thick paint creeping toward thin / snap: how hard cells keep their pigment
  // gloss / grain: lighting / wet: seconds the paint keeps creeping after a push (the Drying knob scales it) / drip: 'top' | 'center'
  var LOOKS = [
    {name: 'Studio pour', pal: ['#D7263D', '#F2C230', '#2457C5', '#F4F1EA', '#15161A', '#0E7C66'], ground: '#1B1B20', canvas: '#101014',
     tondo: 0, radial: 0, drift: 0.004, swirl: 0.000, spread: 0.030, snap: 2.2, gloss: 1.0, grain: 0.9, wet: 0.9, drip: 'top', noise: 1.6},
    {name: 'Solar prominence', pal: ['#FFF6D5', '#FFC83D', '#FF7A1A', '#E0261C', '#7A0C22', '#36060F'], ground: '#070305', canvas: '#020103',
     tondo: 1, radial: 0.020, drift: 0.007, swirl: 0.006, spread: 0.020, snap: 1.2, gloss: 1.5, grain: 1.4, wet: 1.4, drip: 'center', noise: 2.4},
    {name: 'Ocean', pal: ['#0B2A6F', '#1B6FB3', '#2EC4B6', '#F2EFE6', '#D9C39A', '#073B4C'], ground: '#05101D', canvas: '#030a12',
     tondo: 0, radial: 0, drift: 0.006, swirl: 0.004, spread: 0.028, snap: 1.6, gloss: 1.2, grain: 1.0, wet: 1.2, drip: 'top', noise: 1.3},
    {name: 'Neon', pal: ['#FF2BD6', '#19F0FF', '#B6FF2E', '#8A2BFF', '#FF7A00', '#F6F6F6'], ground: '#07070B', canvas: '#040407',
     tondo: 0, radial: 0, drift: 0.003, swirl: 0.000, spread: 0.034, snap: 2.6, gloss: 1.7, grain: 0.7, wet: 0.7, drip: 'top', noise: 2.0},
    {name: 'Earth', pal: ['#C98A2B', '#8B3A1E', '#5E6B2F', '#EEE4CF', '#4A3222', '#B8503A'], ground: '#2B241C', canvas: '#1a1611',
     tondo: 0, radial: 0, drift: 0.003, swirl: 0.000, spread: 0.024, snap: 1.8, gloss: 0.6, grain: 1.5, wet: 0.6, drip: 'top', noise: 1.2},
    {name: 'Pastel', pal: ['#F7A8C4', '#A8E6CF', '#C9B6F2', '#FFF1B8', '#FFD6A5', '#FFFFFF'], ground: '#EFE7DC', canvas: '#d8cfc3',
     tondo: 0, radial: 0, drift: 0.004, swirl: 0.002, spread: 0.028, snap: 1.4, gloss: 0.5, grain: 0.6, wet: 1.0, drip: 'top', noise: 1.1},
    {name: 'Natural mix', pal: ['#F2C230', '#2457C5', '#D7263D', '#F2C230', '#2457C5', '#D7263D'], ground: '#E8DFCD', canvas: '#17181E',
     natural: 1, tondo: 0, radial: 0, drift: 0.003, swirl: 0.000, spread: 0.030, snap: 0, gloss: 0.7, grain: 1.1, wet: 1.0, drip: 'top', noise: 1.6}
  ];

  // Natural mix: Spectral.js 3.0.0, MIT (Ronald van Wijnen). See lab/vendor/spectral.
// SPECTRAL_LUT_BEGIN (generated by lab/tools/build-acrylic-mix.py)
var MIX_SIZE = 65, MIX_DATA = '1yY91yY91yY91yY91yc92Cc92Cc92Cg92Ck92Sk92So92is92yw92y493C883TA83jI83jQ83zY84Dg84To84jw84z485UE85kM850Y86Ek86Uw86k8861I87FU87Vg87lw871888GM88Gc88Wo88m4883I783Y79Ho79H479II69Yc69Ys69Y859ZM59Zc49Zs49Z839aM39ac29as29K419LI09LUz87cz87oy87wy874x8r8x8sEw8sEw8sIw8sIw1iY91iY91iY91yc91yc91yc91yg91yg92Ck92Co92Ss92Sw92i092y492y893DE83TM83jQ83zY84Dg84To84j084z885EI85UQ85kc850o86E086VA86lM87Fc87Fo87V487mE872U88Gk88W088XE88nU783k7830784E79IU69Io69I469JI59ZY59Zo49J849KM39KY29Ko29K4187E087Q087cz87oy8rwy8r4x8r8x8sEx8sEw8cIw8cIw8cIw1Sc91Sc91Sc91Sc91Sc91Sg91Sg91Sk91io91io91ys91yw92C492C892TA92jI92zQ93DY93Tc93jo83zw84D484UE84kM840Y85Ek85Uw85k8851I86FU86Vk86lw862A87GM87Wc87ms87m8873M88Hc78Hw78YA78YQ78og68o068pE68pU58pk58p448qI38qY38qk28q018bE18bQ08bcz8bkz8Lwy8L4y8L8x8MAx8MEx8MIw8MIw8MIw8MIw0ig90ig90ig90ig90ig90ik90ik90io90is90yw90y091C491C891TA91jI91jM91zU92Dc92Tk92js92z093EA93UI93kU930g94Es94U4941E95FQ95Vc95ls951496GI96WY86Wo86m4863I87HY87Ho87X477YM77oc77ow67pA675Q675g5750476E476U376k376027rA17rM07rY07rkz7rsz7b4y7b8y7cAx7cEx7cIx7cIx7sIx7sIx7sIxzyk+zik+zik+zik+zio+zio+zis+zis+ziw+zi0+zy4+zy8+0DA+0DI90TM90jU90jc90zg91Do91T091j8910E92EQ92Uc920o93Ew93VA93lM931Y94Fo94V094mE942U95Gg95Ww95nE953U86Hk86H086YI86YY76oo76o876pM665c665w566A466Q466g366w267A267M16rY06rk06rsz6r0z6r8y6sAy6sEx6sIx6sIx68Ix68Ix68Ix68Ixyio+yio+yio+ySo+ySs+ySs+ySw+yS0+yS0+yS4+yi8+yjA+yjI+yzM+zDU+zDY+zTg+zjo+zzw+0D4+0UE+0kM+00Y+1Ek+1Us+104+2FI+2VU+2lg+21w+3F8+3WM+3mc932s94G894XM94ng943w95IA85IU85Yk85Y475pI75pY65ps65p855qM55qc45qs35q825rI25rY15rg05rs05r0z5r8z5sAy5sEy58Iy58Iy58Iy58Iy6MIx6MIx6MIxxis+xSs+xSs/xCw/xCw/xC0/xC0/xC4/xC8/xC8/xDE/xDI+xTM+xTQ+xjY+xjg+xzo+yDw+yT4+ykA+y0I+zEU+zUg+z0o+0E0+0VA+0lQ+1Fc+1Vo+1l4+12I+2GY+2Wo+2m4+23I+3HY93Xo93n8934M934g84Iw84JE84ZU74Zo64Z464qI54qY54qo44q434rI24rU24rg14rs04r004r8z4sAz4sEz48Iy48Iy48Iy5MIy5MIy5MIy5cIy5cIywCw/wCw/vyw/vy0/vy0/vi4/vi4/vi8/vjA/vjE/vjI/vjM/vzQ/vzY/wDc/wDk/wTs/wj0/wz8/xEE/xUQ/xkc/yEk/yUw/yk8/y1I/zVY/zlk/z10/0GA/0mQ/02g/1Gw+1XA+1nU+13k+2H0+2YI92oY92os9248825Q83Jk73J073KE63aY53ao53a043bE33bQ23bc23bo13bw13r403sA03sEz38Ez38Ez38Iz4MIz4MIz4cIz4cIz4cIy4sIyuy0/ui0/ui4/uS4/uS5AuC9AuC9AuDBAuDFAuDJAuDNAuDRAuDZAuTdAujk/ujo/uzw/vD4/vUE/vkM/v0U/wEg/wks/w04/xFE/xlQ/x1g/yFs/yl8/y2M/zGc/zWs/z28/0HM/0Xc/0nw+04A+1IU+1Ik91Y491pM91pc815w716A716Q62Kk52K052LA42LQ32Lc32Lk22bw12b412b802sA02sE028E028Ez3MEz3MEz3cEz3cEz3sEz3sEz3sEzti5AtS5AtC9Asy9Asy9AsjBAsjBAsjFAsjJAsjNAsjRAsjVAsjdAszhAszpAtDxAtT5AtkBAt0JAuERAuUdAukpAvE1AvVBAvlNAwFZAwVpAw11AxGFAxWVAx2lAyG1AyXE/ynY/zHo/zX8/zoM/zog+z40+0JE90ZY90Zo80p880qM70qg606w6068507M407Y31Lk31Ls21L021b811cA11sE01sE018E018E02ME02cE02cE02sE02sE028E028EzsC9Ary9Ari9ArjBBrTBBrDFBrDFBrDJBqzNBqzRBqzVBrDZBrDhBrDlBrTtBrj1Brz9BsEFBsUNBskZBs0hBtEtBtk5Bt1FBuVVBulhBvFxBvV9Bv2NAwGdAwWtAw3BAxHRAxXhAxn1Ax4I/yIY/yYs/ypA+y5Q+y5k9zJ48zKI8zaY7zao6za46zrI5zrU4zrg4z7s3z7020L420L820cA10sA10sA108A11ME11ME11cE01cE01sE018E018E02ME0qjBBqTBBqTBBqDFBpzFBpjFBpjJBpjNBpTRBpTVBpTZBpjdBpjlBpjpBpzxBqD5BqUBBqkJBq0VBrEdBrUpBr01BsFBBslNBs1ZBtVpBtl5BuGFBuWVBu2pBvG5BvXJBv3dBwHtAwYBAwoVAw4k/xI4/xZM+xZg+xpw9x6E9x6U8yKk7yK07yLE6ybQ5ybc4yro4yrw3y703y782zL82zcA2zsA2zsA2z8A10MA10cA10cA10sA108A108A11ME11ME1pTBBpDFBozFCojFCoTJCoTJCoDNCoDRCnzRCnzZCnzdCoDhCoDlCoDtCoT1Coj9Co0FCpENCpUZCpkhCqEtCqU5CqlFCrFVCrlhCr1xCsWBCsmRCtGhCtWxCt3BBuHVBuXlBu35BvINAvYhAvoxAv5E/v5Y/wJs+wZ8+waQ9wqg8wqw8w7A7w7M6xLY5xLk5xbs4xb04xr43x783yL83yb83yr82y782y8A2zMA2zcA2zsA2zsA2z8A10MA10MA10cA1nzFCnjFCnTJCnDJCnDJCmzNCmjNCmjRCmjVDmTZDmjdDmjlDmjpDmzxDmz5DnEBDnUJDnkRDn0dDoUpDok1DpFBDpVNDp1ZDqFpDql5Cq2JCrWZCr2pCsG5CsXNCs3dCtHxCtYFBt4ZBuItBuY9AuZRAupk/u54+vKI+vKc9vas8va48vrI7vrU6v7g6wLo5wLw5wb04wr44w744xL43xb83xr83x783yL83yL83yb82yr82y782zMA2zMA2zcA2zsA2mjJCmTJDmDJDlzJDljNDlTNDlTRDlDVDlDZDlDdDlDhDlDlDlDtDlT1Dlj9Dl0FDmENDmUZDmkhDm0tDnU5DnlFDoFVDoVhDo1xDpWBDpmRDqGhDqWxDq3FDrHVDrnpCr39CsIRCsYlBso5Bs5JAtJdAtZw/tqE/tqU+t6k9uK09uLE8ubQ7ubc7urk6u7s6vLw5vb05vr05v744wL44wb44wr44w744xL43xb83xr83x783x783yL83yb83yr82yr82lTJDkzJDkjNDkTNDkTNEkDREjzVEjzVEjjZEjjdEjjlEjzpEjzxEkD5EkEBEkUJEkkREk0dElUlElkxEmE9EmVNEm1ZEnFpEnl5EoGJEoWZEo2pEpG9DpnNDp3hDqX1DqoJDq4dCrIxCrZFBrpVBr5pAsJ9AsaM/sag+sqw+s689s7I8tLU8tbg7tro7t7s6uLw6ubw5ur05u705vL05vb05vr04v744wL44wb44wr44w744xL43xb83xr83xr83x783kDNEjjNEjTNEjDNEizREizREijVEijZEiTdFiThFiTlFiTtFij1Fij5Fi0BFjENFjUVFjkhFkEtFkU5Fk1FFlFRFllhFl1xFmWBEm2REnGhEnm1EoHFEoXZEontEpIBDpYVDpopDp49CqJNCqZhBqp1Bq6JArKY/rKo/ra4+rrE9rrQ9r7Y8sLg8sbo7srs7tLs6tbw6trw6t7w6ubw6ur05u705vL05vb05vr05v744wL44wb44wb44wr44w744xL43izNEiTNEiDNFhzRFhjRFhjVFhTVFhDZFhDdFhDlFhDpFhDxFhT1FhT9FhkFFh0RFiEZFiklFi0xFjE9FjlJFj1ZFkVpFk15FlGJFlmZFmGpFmW9Fm3RFnHlEnn1En4JEoIdEoYxDopFDo5ZCpJtCpaBBpqRApqhAp6w/qK8+qbI+qrU9q7c9rLg8rbo8rro7sLo7sbs7srs7tLs6tbw6trw6t7w6uLw6ubw5ur05u705vL05vb05vr04v744wL44wb44hjNFhTNFgzRFgjRGgTVGgTVGgDZGgDdGfzhGfzlGfztGgDxGgD5GgUBGgkJGg0VGhEdGhUpGhk1GiFFGiVRGi1hGjFxGjmBGkGRGkWhGk21GlXFFlnZFl3tFmYBFmoVEm4pEnI9EnZRDnplDn55CoKJBoaZBoapAoq4/o7E/pLM+pbU+prc9qLg9qbk8q7k8rLk8rbo8r7o7sLo7sbs7srs7tLs6tbw6trw6t7w6uLw6ubw5ur05u705vL05vb05vr05gTRGgDRGfzRGfjRGfTVGfDZHezZHezdHezhHezpHeztHez1HfD9HfEFHfUNHfkZHf0hHgEtHgk9Hg1JHhVZHhllHiF1HimJHi2ZHjWpGjm9GkHRGkXlGk35GlINFlYhFlo1Fl5JEmJdEmZxDmqBCm6RCnKhBnaxBnq9An7I/oLQ/obY+orc+pLc9pbg9p7g9qLk9qrk8q7k8rLo8rro8r7o7sLs7sbs7s7s7tLs6tbw6trw6t7w6uLw6ubw5ur05u705fTRGfDRHejRHeTVHeDVHeDZHdzdIdzhIdjlIdjpIdjxIdz5Id0BIeEJIeURIekdIe0pIfE1IflBIf1RIgVdIgltIhF9IhWRHh2hHiG1HinJHi3ZHjXtHjoFGj4ZGkItGkZBFkpVFk5lElJ5DlaJDlqZCl6pCmK1BmbBAmrJAm7Q/nbU/n7Y/oLY+orc+o7c+pbg9prg9qLg9qbk8qrk8rLk8rbo8rro8r7o7sLs7srs7s7s7tLs6tbw6trw6t7w6uLw6eTRHdzRHdjVIdTVIdDZIczZIczdJcjhJcjlJcjtJcjxJcz5Jc0BJdENJdUVJdkhJd0tJeE5JeVJJe1VJfFlIfl1IgGFIgWZIg2pIhG9IhnRIh3lHiH5HiYNHi4hGjI1GjZJGjpdFjpxFj6BEkKRDkahDkqtCk65ClbBBlrJAmLNAmbRAm7U/nbU/nrY/oLY+obc+o7c+pLc9prg9p7g9qLk9qrk8q7k8rLk8rbo8rro7r7o7sbs7srs7s7s7tLs6tbw6dTVIczVIcjVJcTVJcDZJbzdJbzhJbjlKbjpKbjxKbj1Kbz9Kb0FKcERKcUZKcklKc0xKdFBKdlNJd1dJeFtJel9Je2NJfWhJfm1JgHJJgXdIg3xIhIFIhYZHhotHh5BHiJVGiZlGip5Fi6JEjKZEjalDjqxDj65CkbBCkrFBlLJBlrNAl7RAmbRAm7U/nLU/nrY/n7Y+obY+orc+pLc+pbg9prg9qLg9qbk9qrk8q7k8rLo8rro8r7o7sLo7sbs7srs7cTVJbzVJbjVKbTZKbDZKbDdKazhLazlLajtLajxLaz5La0BLbEJLbEVLbUdLbkpLb05LcFFLclVKc1lKdV1KdmFKd2ZKeWpKem9KfHRJfXlJfn5Jf4NJgIhIgY1IgpJHg5dHhJxGhaBGhqNFh6dEiKpEiqxDi65DjbBCj7BCkLFBkrJBlLJBlrNAl7RAmbRAm7U/nLU/nrY/n7Y+obY+orc+o7c+pbg9prg9p7g9qLk9qbk8q7k8rLk8rbo8rro8r7o7bTVKbDVKazZLajZLaTdLaDhLZzlMZzpMZztMZz1MZz9MZ0FMaENMaUZMaklMa0xMbE9MbVNMbldLb1tLcV9LcmNLdGhLdW1LdnJKd3dKeXxKeoFKe4ZJfItJfZBIfpVIfplHf51HgKFGgaVGg6hFhKpEhqxEh65Dia9Di69DjbBCj7FCkbFBk7JBlLJBlrNAl7RAmbRAm7U/nLU/nbU/n7Y+oLY+orc+o7c+pLc9pbg9prg9qLg9qbk9qrk8q7k8rLk8aTZLaDZLZzZMZjdMZTdMZThNZDlNZDtNYzxNYz5NZEBNZEJNZURNZUdNZkpNZ01NaFFNaVRNa1hMbF1MbWFMbmVMcGpMcW9McnRLc3lLdH5LdYNKdohKd41JeJJJeZdIeptIe59HfKJHfaVGf6hGgKpFgqtFhKxEhq1EiK5Diq9DjK9CjrBCj7FCkbFBk7JBlLNBlrNAl7RAmbRAmrU/nLU/nbU/n7Y/oLY+obc+orc+pLc+pbg9prg9p7g9qLk9qbk8ZjZMZTZNZDdNYzdNYjhOYTlOYTpOYDtOYD1PYD9PYEFPYUNPYUZOYkhOY0tOZE9OZVJOZlZOZ1pOaF9NaWNNa2hNbG1NbXFMbnZMb3xMcIFLcYZLcotLc49Kc5RKdJhJdZxJdqBIeKNHeaVHe6dGfalGf6pFgatFg6xEha1Eh65Dia5Di69DjLBCjrBCkLFCkbFBk7JBlLNBlrNAl7RAmbRAmrQ/nLU/nbU/nrY/oLY+obY+orc+o7c+pLc9pbg9p7g9YzZNYjdOYTdOYDhPXzhPXjlPXjtQXTxQXT5QXUBQXUJQXkRQXkdQX0pQYE1PYVBPYlRPY1hPZFxPZWFOZmVOZ2pOaG9OaXRNanlNa35NbINMbIhMbY1LbpFLb5ZKcJlKcZ1JcqBJdKNIdqVHd6dHeqhGfKlGfqpFgKtFgqxFhKxEhq1EiK5Dia9Di69DjbBCjrBCkLFCkrJBk7JBlbNBlrNAl7RAmbRAmrQ/nLU/nbU/nrY/n7Y+obY+orc+o7c+pLc9YDdPXzdPXjhQXThQXDlRWzpRWztRWj1RWj9SWkFSWkNRW0VRW0hRXEtRXU9RXVJRXlZQX1pQYF5QYWNQYmhPY2xPZHFPZXZOZntOZ4BOZ4VNaIpNaY5MapNMa5dLbJpKbZ5Kb6BJcKNJcqRIdKZId6dHeahHe6lGfalGf6pFgatFg6xEha1Ehq1EiK5Diq9DjK9CjbBCj7FCkLFBkrJBk7JBlbNBlrNAl7RAmbRAmrQ/m7U/nbU/nrY/n7Y+oLY+obc+XTdQXDhRWzhRWjlSWTpSWDtTWDxTWD5TWEBTWEJTWERTWEdTWEpTWU1TWlBSWlRSW1hSXFxRXWBRXmVRX2pQX29QYHRQYXhPYn1PYoJOY4dOZIxNZZBNZZRMZ5hMaJtLaZ5La6BKbaJJb6NJcqRIdKVIdqZHeKdHeqhGfKlGfqpFgKtFgqxFhKxEha1Eh65Dia5Diq9DjLBCjrBCj7FCkbFBkrJBk7JBlbNBlrNAl7RAmbRAmrQ/m7U/nLU/nrY/n7Y/WjhRWThSWDlTVzlTVjpUVjxUVT1VVT9VVUFVVUNVVUVVVUhVVktUVk5UV1JUV1ZTWFpTWV5TWWNSWmdSW2xSXHFRXHZRXXtQXYBQXoRPX4lPX41OYJFOYZVNY5hMZJtMZp1LaJ9LaqFKbKJJb6NJcaRIc6VIdaZHd6dHeahGe6lGfapGf6pFgatFg6xEhK1Ehq1EiK5Dia9Di69DjLBCjrBCj7FCkbFBkrJBlLJBlbNBlrNAl7RAmbRAmrQ/m7U/nLU/WDlTVzlUVjlVVTpVVDtWUzxWUz5XU0BXUkJXUkRXUkdXU0pWU01WU1BWVFRVVFhVVVxUVWBUVmVUV2pTV25TWHNSWHhSWX1RWYFRWoZQW4pQW45PXJJOXpVOX5hNYZtNY51MZZ5LaJ9LaqBKbKJKbqNJcKRJc6VIdaZId6dHeahHe6hGfKlGfqpFgKtFgqtFg6xEha1Eh61EiK5Diq9Di69DjbBCjrBCkLFCkbFBkrJBlLJBlbNBlrNAl7RAmbRAmrRAVTlVVDpWUzpWUjtXUjxYUT1YUD9ZUEFZUENZUEVZUEhZUEtYUE9YUFJXUVZXUVpWUl5WUmJVU2dVU2xUU3BUVHVTVHpTVX9SVYNSVodRVotRV49QWZNPWpVPXJhOXppNYJtNY51MZZ5LZ59LaqBKbKFKbqNJcKRJcqVIdKVIdqZHeKdHeqhGfKlGfapGf6pFgatFg6xEhKxEhq1Eh65Dia5Diq9DjK9CjbBCj7BCkLFCkbFBk7JBlLJBlbNAlrNAl7RAUzpXUjpYUTtZUDxZTz1aTz5aTkBbTkJbTURbTUdbTUpbTU1aTVBaTlRZTlhZTlxYTmBXT2VXT2lWT25WUHNVUHdVUHxUUYBTUYVTUolSU4xRVJBRVZNQV5VPWZdPW5lOXppNYJtNY51MZZ5LZ59LaaBKa6FKbqJJcKNJcqRIdKVIdaZHd6dHeahHe6lGfalGfqpFgKtFgqtFg6xEha1Ehq1EiK5Dia9Di69DjLBCjbBCj7FCkLFCkbFBk7JBlLJBlbNAUTtZUDtaTzxbTj1cTT5cTEBdTEFdTENdS0ZdS0hdS0tdS09cS1JcS1ZbS1paS15aS2JZS2dYS2tYS3BXTHVWTHlWTH1VTIJUTYZUTolTT41SUJBRUpJRVJRQV5ZPWZdPXJlOXppNYJtNY51MZZ5LZ59LaaBKa6FKbaJJb6NJcaRIc6VIdaZHd6dHeKdHeqhGfKlGfqpFf6pFgatFgqxEhKxEha1Eh65DiK5Diq9Di69DjLBCjrBCj7FCkLFBkrJBk7JBTztbTjxcTT1dTD5eSz9fSkFfSkNgSUVgSUdgSUpfSE1fSFFeSFReSFhdSFxcSGBbSGRbSGlaSG1ZSHJYSHZYSHtXSH9WSYNVSYdVSopUTI1TTY9SUJFRUpNRVJVQV5ZPWZhOXJlOXppNYJtNYp1MZZ5LZ59LaaBKa6FKbaJJb6NJcaRIc6VIdKZIdqZHeKdHeqhGe6lGfalGf6pFgKtFgqtFg6xEha1Ehq1Eh65Dia5Diq9DjK9CjbBCjrBCj7FCkbFBTTxdTD1eSz5gSj9hSUBhSEJiSERiR0ZiR0liRkxiRk9hRVJhRVZgRVpfRV5eRGJdRGdcRGtbRG9bRHRaRHhZRHxYRIBXRYRWRodWR4pVSYxUS49TTZBSUJJRUpNRVZVQV5ZPWZhOXJlOXppNYJtNYp1MZJ5LZ59LaaBKa6FKbKJJbqNJcKRJcqVIdKVIdqZHd6dHeahHe6hGfKlGfqpFf6pFgatFgqxEhKxEha1Eh61EiK5Dia9Di69DjK9CjbBCjrBCSz1gSj5hST9iSEBkR0JkRkNlRkVlRUhlREtlRE5kQ1FkQ1RjQlhiQlxhQWBgQWRfQWleQG1dQHFcQHVbQHlaQH1ZQYFYQYRXQ4dWRIpVRoxVSY5US49TTpFSUJJRU5RQVZVQV5ZPWphOXJlOXppNYJtNYp1MZJ5LZp9LaKBKaqFKbKJKbqNJcKNJcqRIc6VIdaZHd6dHeKdHeqhGfKlGfapGf6pFgKtFgqtFg6xEhK1Ehq1Eh65DiK5Diq9Di69DjLBCST5iSD9kR0BlRkFnRUNnREVoREdoQ0poQkxoQU9nQVNmQFZlP1pkP15jPmJiPWZhPWpgPG9fPHNdPHdcPHpbPH5aPYFZPoRYQIdXQolWRItVR4xUSY5TTJBTTpFSUZNRU5RQVZVQWJdPWphOXJlOXppNYJtNYp1MZJ5MZp9LaKBLaqFKbKJKbqJJb6NJcaRIc6VIdaZIdqZHeKdHeahGe6lGfKlGfqpFf6tFgatFgqxEhKxEha1Ehq1EiK5Dia5Diq9DRz9lRkBnRUFoRENqQ0RrQkZrQUlrQUtrQE5rP1FqPlVpPVhoPFxmO2BlOmRkOmhjOWxhOXBgOHRfOHheOHtcOX5bOoFaPIRZPoZYQIhXQ4pWRYtVSI1USo5TTZBST5FSUZNRU5RQVpVQWJdPWphOXJlOXppNYJtNYpxMZJ5MZp9LaKBLaqBKbKFKbaJJb6NJcaRIcqVIdKVIdqZHd6dHeahHeqhGfKlGfapGf6pFgKtFgqtFg6xEhK1Ehq1Eh65DiK5DRUFoREFqQ0NsQkRtQUZuQEhvP0pvPk1uPVBuPFNtO1drOlpqOV5pOGJnN2ZmNmpkNW5jNXJiNHVgNXlfNXxeNn9cOIFbOYNaPIVZPodYQYlXQ4pWRoxVSI1US49TTZBST5JRUpNRVJRQVpZPWJdPWphOXJlOXppNYJtNYpxMZJ1MZp5LaJ9LaqBKa6FKbaJJb6NJcKRJcqVIdKVIdaZHd6dHeKdHeqhGe6lGfalGfqpFf6tFgatFgqxEg6xEha1Ehq1EREJrQ0NuQkRvQUVxP0dyPklyPUxyPE9yO1JxOVVwOFluN1xtNWBrNGRpM2hoMmtmMW9kMXNjMXZhMXlgMnxfM39dNYFcOINbOoRZPYZYP4hXQolWRItVR4xUSY5US49TTpFSUJJRUpNRVJVQVpZPWJdPWphOXJlOXppNYJtNYpxMZJ1MZp5LaJ9LaaBKa6FKbaJJbqNJcKRJcqRIc6VIdaZIdqdHeKdHeahGe6hGfKlGfapGf6pFgKtFgqtFg6xEhKxEQkNvQURxQEVzP0d0Pkl1PEt2O052OlF1OFR0NldyNVtxM15vMmJtMWZrL2lqLm1oLnBmLXRkLXdjLnlhMHxgMX5eNIBdNoJbOYNaO4VZPodYQIhXQ4pWRYtVR41USo5TTJBTTpFSUJJRUpNRVJVQVpZPWJdPWphOXJlOXppNYJtNYpxMZJ1MZp5LZ59LaaBKa6FKbKJJbqNJcKNJcaRIc6VIdKZIdqZHd6dHeahHeqhGfKlGfalGfqpFgKtFgatFgqxFQERzP0V1Pkd3PUh4PEp5Ok16OU95N1J4NVZ3M1l1Mlx0MGByLmRvLWdtK2trKm5pKnFoKnRmK3dkLHliLnthMH1fMn9dNYFcN4JbOoRaPIZZP4dXQYlXQ4pWRoxVSI1USo9TTJBSTpFSUZJRU5RQVZVQV5ZPWZdPW5hOXZlOXppNYJtNYpxMZJ1MZp5LZ59LaaBKa6FKbKJKbqJJb6NJcaRIcqVIdKVIdaZHd6dHeKdHeqhGe6lGfKlGfqpFf6pFgKtFP0Z2Pkd5PEh7O0p9Okx9OE5+NlF9NFR8Mld6MFt4Ll52LGJ0KmVyKWhvKGxtJ29rJ3JpJ3RnKHdlKnljLHthL31gMX5eNIBdNoJbOYNaO4VZPYZYQIhXQolWRItVRoxVSY1US49TTZBST5FSUZNRU5RQVZVQV5ZPWZdPW5hOXZlOXppNYJtNYpxMZJ1MZZ5LZ59LaaBKaqFKbKJKbqJJb6NJcaRIcqVIdKVIdaZHdqdHeKdHeahHeqhGfKlGfapGfqpFPUd6PEh9O0p/OUuBOE6CNlCCNFOBMlZ/L1l+LV17K2B5KWN2J2Z0JWpxJG1vI29sJHJqJXRoJndmKHhkK3piLXxgMH1fMn9dNYFcN4JbOoRaPIVZPodYQIhXQ4pWRYtVR41USY5US49TTZBST5JRUZNRU5RQVZVQV5ZPWZdPW5hOXZlOXppNYJtNYpxMZJ1MZZ5LZ59LaaBKaqFKbKFKbaJJb6NJcKRJcqRIc6VIdaZIdqZHd6dHeahHeqhGe6lGfalGO0h/OkqCOUuEN02FNU+GM1KGMVWFL1iDLFuBKl5+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';
// SPECTRAL_LUT_END

  // ---------------------------------------------------------------- shaders
  var VS = '#version 300 es\nprecision highp float;\nout vec2 v_uv;\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);v_uv=p;}';
  var NOISE = [
    'float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
    'float fbm(vec2 p){return vnoise(p)*.6+vnoise(p*2.03+7.1)*.3+vnoise(p*4.1+3.7)*.1;}',
    'vec2 curl(vec2 p){float e=.02;float n1=fbm(p+vec2(0,e)),n2=fbm(p-vec2(0,e)),n3=fbm(p+vec2(e,0)),n4=fbm(p-vec2(e,0));return vec2(n1-n2,-(n3-n4))/(2.*e);}'
  ].join('\n');
  var BRUSH_U = 'uniform vec4 uBA[' + MAXB + '],uBB[' + MAXB + '];uniform int uNB;';   // BA: x y (p-space) vx vy / BB: radius deposit pigment push
  // velocity: xy creeping flow (window units / s), zw remembered stroke direction
  var FS_VEL = ['#version 300 es', 'precision highp float;', 'in vec2 v_uv;out vec4 o;',
    'uniform sampler2D uVel,uPaintB,uBody;uniform mat3 uHinv;uniform vec2 uTexel;',
    'uniform float uDt,uTime,uAspect,uDamp,uDrift,uNoise,uRadial,uSwirl,uSpread,uBodyPush,uVmax;uniform vec2 uGravity;',
    BRUSH_U, 'uniform vec4 uPA[' + MAXP + '];uniform vec2 uPB[' + MAXP + '];uniform int uNP;',
    NOISE,
    'void main(){',
    ' vec2 uv=v_uv;vec4 V0=texture(uVel,uv);vec2 back=clamp(uv-V0.xy*uDt,0.,1.);vec4 V=texture(uVel,back);vec2 v=V.xy*uDamp;vec2 mem=V.zw;',
    ' vec2 p=vec2(uv.x*uAspect,uv.y);vec2 c=vec2(.5*uAspect,.5);vec2 d=p-c;float r=length(d);',
    ' vec2 cn=curl(p*uNoise+vec2(uTime*.03,-uTime*.021));v+=cn*uDrift*uDt;',
    ' v+=normalize(d+vec2(1e-5,0.))*uRadial*smoothstep(.02,.3,r)*uDt;v+=vec2(-d.y,d.x)*uSwirl*uDt;v+=uGravity*uDt;',
    ' float hx=texture(uPaintB,uv+vec2(uTexel.x,0)).b-texture(uPaintB,uv-vec2(uTexel.x,0)).b;float hy=texture(uPaintB,uv+vec2(0,uTexel.y)).b-texture(uPaintB,uv-vec2(0,uTexel.y)).b;',
    ' v-=vec2(hx,hy)*uSpread*uDt;',
    ' for(int i=0;i<' + MAXB + ';i++){if(i>=uNB)break;vec4 a=uBA[i],b=uBB[i];vec2 q=p-a.xy;float dd=length(q)/max(b.x,1e-4);float w=exp(-dd*dd*2.);',
    '  v+=(a.zw*.12-v)*w*clamp(uDt*10.,0.,1.);v+=normalize(q+vec2(1e-5,0.))*b.w*w*uDt;}',
    ' for(int i=0;i<' + MAXP + ';i++){if(i>=uNP)break;vec4 a=uPA[i];vec2 bb=uPB[i];vec2 q=p-a.xy;float dd=length(q)/max(bb.x,1e-4);float w=exp(-dd*dd*1.5)*bb.y;',
    '  v+=(a.zw*.12-v)*w*clamp(uDt*4.,0.,1.);}',
    ' if(uBodyPush>0.){vec3 k=uHinv*vec3(uv.x,1.-uv.y,1.);vec2 kuv=k.xy/k.z;if(kuv.x>0.&&kuv.x<1.&&kuv.y>0.&&kuv.y<1.){',
    '  vec2 e=vec2(1./128.,1./106.);float s=texture(uBody,kuv).g*32.-8.;float sx=texture(uBody,kuv+vec2(e.x,0)).g-texture(uBody,kuv-vec2(e.x,0)).g;float sy=texture(uBody,kuv+vec2(0,e.y)).g-texture(uBody,kuv-vec2(0,e.y)).g;',
    '  vec2 g=vec2(sx*uAspect,-sy);float gl2=length(g);if(gl2>1e-5){float w=smoothstep(-6.,-1.,s)*(1.-smoothstep(1.,5.,s));v+=(g/gl2)*uBodyPush*w*uDt;}}}',
    ' float sp=length(v);if(sp>uVmax)v*=uVmax/sp;',
    ' mem=mix(mem,v/max(sp,1e-5),clamp(sp*60.,0.,1.)*clamp(uDt*5.,0.,1.));',
    ' o=vec4(v,mem);}'].join('\n');
  // paint (MRT): o0 = weights of pigments 0-3, o1 = weights 4-5, thickness, 0
  var FS_PAINT = ['#version 300 es', 'precision highp float;', 'in vec2 v_uv;layout(location=0) out vec4 o0;layout(location=1) out vec4 o1;',
    'uniform sampler2D uVel,uPaintA,uPaintB;uniform float uDt,uAspect,uFade,uSnap,uTime;',
    BRUSH_U,
    'void main(){',
    ' vec2 uv=v_uv;vec2 v=texture(uVel,uv).xy;vec2 back=clamp(uv-v*uDt,0.,1.);vec4 A=texture(uPaintA,back);vec4 B=texture(uPaintB,back);',
    ' float th=B.b;vec2 p=vec2(uv.x*uAspect,uv.y);',
    ' float w[6];w[0]=A.r;w[1]=A.g;w[2]=A.b;w[3]=A.a;w[4]=B.r;w[5]=B.g;',
    ' if(th>.01){int bi=0;float bw=-1.;for(int i=0;i<6;i++){if(w[i]>bw){bw=w[i];bi=i;}}',
    '  float k=clamp(uSnap*uDt,0.,1.);for(int i=0;i<6;i++){w[i]=mix(w[i],i==bi?1.:0.,k);}}',
    ' for(int i=0;i<' + MAXB + ';i++){if(i>=uNB)break;vec4 a=uBA[i],b=uBB[i];vec2 q=p-a.xy;float dd=length(q)/max(b.x,1e-4);float g=exp(-dd*dd*2.5);',
    '  float dep=g*b.y*uDt;if(dep>1e-5){int pg=int(b.z+.5);if(b.w>.018){float layer=floor(max(0.,1.-dd)*4.+uTime*.8);pg=(pg+int(layer)*2)%6;}float c=clamp(dep*6./(th+.12),0.,1.);for(int j=0;j<6;j++){w[j]=mix(w[j],j==pg?1.:0.,c);}th+=dep;}}',
    ' float s=w[0]+w[1]+w[2]+w[3]+w[4]+w[5];if(s>1e-5){for(int i=0;i<6;i++)w[i]/=s;}',
    ' th=min(th*uFade,2.6);',
    ' o0=vec4(w[0],w[1],w[2],w[3]);o1=vec4(w[4],w[5],th,0.);}'].join('\n');
  // lighting at canvas resolution
  var FS_SHOW = ['#version 300 es', 'precision highp float;', 'in vec2 v_uv;out vec4 o;',
    'uniform sampler2D uVel,uPaintA,uPaintB;uniform vec2 uTexel;uniform float uAspect,uThick,uGloss,uGrain,uBright,uTondo,uWet;uniform vec3 uGround,uCanvas;uniform vec3 uPal[6];uniform sampler2D uMixLut;uniform float uNatural;',
    NOISE,
    'void main(){',
    ' vec2 uv=v_uv;vec4 A=texture(uPaintA,uv);vec4 B=texture(uPaintB,uv);vec4 V=texture(uVel,uv);float th=B.b;',
    ' vec3 pig=A.r*uPal[0]+A.g*uPal[1]+A.b*uPal[2]+A.a*uPal[3]+B.r*uPal[4]+B.g*uPal[5];',
    ' if(uNatural>.5){vec3 amounts=vec3(A.r+A.a,A.g+B.r,A.b+B.g);float total=dot(amounts,vec3(1.));if(total>1e-5){vec2 uvMix=amounts.xy/total;pig=texture(uMixLut,(uvMix*64.+.5)/65.).rgb;}}',
    ' float hx=(texture(uPaintB,uv+vec2(uTexel.x,0)).b-texture(uPaintB,uv-vec2(uTexel.x,0)).b)*uThick;float hy=(texture(uPaintB,uv+vec2(0,uTexel.y)).b-texture(uPaintB,uv-vec2(0,uTexel.y)).b)*uThick;',
    ' float cov=smoothstep(.02,.22,th);',
    ' vec2 dir=V.zw;float dl=length(dir);dir=dl>1e-3?dir/dl:vec2(1.,0.);vec2 perp=vec2(-dir.y,dir.x);vec2 sp=vec2(uv.x*uAspect,uv.y);',
    ' float g=vnoise(vec2(dot(sp,perp)*620.,dot(sp,dir)*40.))-.5;g+=.5*(vnoise(vec2(dot(sp,perp)*1300.,dot(sp,dir)*90.))-.5);',
    ' float gk=uGrain*cov*clamp(th*uThick,0.,1.)*.25;hx+=g*gk*perp.x;hy+=g*gk*perp.y;',
    ' vec3 N=normalize(vec3(-hx*7.,-hy*7.,1.));vec3 L=normalize(vec3(-.55,.7,.75));vec3 H=normalize(L+vec3(0.,0.,1.));',
    ' float diff=clamp(dot(N,L),0.,1.);float spec=pow(clamp(dot(N,H),0.,1.),48.)*uGloss*(.35+.65*uWet);',
    ' vec3 base=mix(uGround,pig,cov);float edge=clamp(length(vec2(hx,hy))*2.2,0.,1.);',
    ' vec3 col=base*(.62+.5*diff)*(1.-.22*edge*cov)+spec*cov*vec3(1.);',
    ' col+=uGround*(.08*(1.-cov))*(diff-.5);',
    ' if(uTondo>.5){vec2 c=vec2(.5*uAspect,.5);float r=length(sp-c);float m=1.-smoothstep(.465,.482,r);float rim=smoothstep(.455,.47,r)*(1.-smoothstep(.47,.485,r));col=mix(uCanvas,col,m)+rim*.08;}',
    ' o=vec4(col*uBright,1.);}'].join('\n');

  registerWallPlugin({id: 'acrylic', title: 'Acrylic Paint', author: 'lab', create: create});

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Acrylic needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Acrylic needs EXT_color_buffer_float');
    var made = [];
    function compile(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Acrylic shader: ' + e); }
      return s;
    }
    function program(fs) {
      var p = gl.createProgram(), a = compile(gl.VERTEX_SHADER, VS), b = compile(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); gl.deleteShader(a); gl.deleteShader(b);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error('Acrylic link: ' + e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); var name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var PV = program(FS_VEL), PP = program(FS_PAINT), PS = program(FS_SHOW);

    function mkTex(w, h, ifmt, fmt, type, filt) {
      var t = gl.createTexture(); made.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function mkFbo(texs) {
      var f = gl.createFramebuffer(); made.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      var bufs = [];
      texs.forEach(function (t, i) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); bufs.push(gl.COLOR_ATTACHMENT0 + i); });
      gl.drawBuffers(bufs);
      var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Acrylic: float framebuffer incomplete (' + st + ')');
      return f;
    }
    // simulation at half resolution
    var SW = 0, SH = 0, vel = [], pA = [], pB = [], fvel = [], fpaint = [], cur = 0, W = 0, H = 0, aspect = 1.6;
    function buildSim() {
      W = canvas.width; H = canvas.height; aspect = W / Math.max(1, H);
      SW = Math.max(64, Math.round(W / 2)); SH = Math.max(40, Math.round(H / 2));
      for (var i = 0; i < 2; i++) {
        vel[i] = mkTex(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); fvel[i] = mkFbo([vel[i]]);
        pA[i] = mkTex(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); pB[i] = mkTex(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
        fpaint[i] = mkFbo([pA[i], pB[i]]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fvel[i]); gl.clearColor(0, 0, 1, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fpaint[i]); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    buildSim();
    var mixTex = mkTex(MIX_SIZE, MIX_SIZE, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, gl.LINEAR);
    var rawMix = atob(MIX_DATA), mixBytes = new Uint8Array(rawMix.length);
    for (var mi=0;mi<rawMix.length;mi++) mixBytes[mi]=rawMix.charCodeAt(mi);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, mixTex);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,MIX_SIZE,MIX_SIZE,gl.RGB,gl.UNSIGNED_BYTE,mixBytes);

    // body texture: R = mask, G = sdf mapped from -8..24 cells (the suminagashi idiom)
    if (!window.WallBody) throw new Error('Acrylic needs plugins/body.js');
    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {minMm: 110}), bodyU8 = new Uint8Array(BW * BH * 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var btex = gl.createTexture(); made.push(['Texture', btex]);
    gl.bindTexture(gl.TEXTURE_2D, btex);
    for (var bi = 0; bi < BW * BH; bi++) { bodyU8[bi * 2] = 0; bodyU8[bi * 2 + 1] = 255; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, BW, BH, 0, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ---------------------------------------------------------------- state
    var settings = {look: 0, thick: 1, flow: 1, dry: 10, gloss: 1, brightness: 1};
    var ranges = {thick: [0.2, 2], flow: [0.2, 2], dry: [2, 30], gloss: [0, 2], brightness: [0.5, 1.5]};
    var look = LOOKS[0], palF = new Float32Array(18), ground = hex(look.ground), canvasCol = hex(look.canvas);
    var BA = new Float32Array(MAXB * 4), BB = new Float32Array(MAXB * 4), PA = new Float32Array(MAXP * 4), PB = new Float32Array(MAXP * 2);
    var hands = [], drips = [], nextId = 1, lastFinger = -Infinity, pigment = 0, actors = new Map();
    var time = 0, frames = 0, frameMs = 0, dead = false, out = null, lastNote = 0;
    var primedAt = -1e9, tilt = [0, 0], turb = 0, wet = 1, occupiedAt = 0, lastContact = 0, dripBudget = 0, idleDab = 6, roomNow = null, roomMotion = 0;
    var stats = {dabs: 0, strokes: 0, pours: 0, drips: 0, bodyPushFrames: 0, smears: 0, roomTilts: 0};
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var seed = 90217;
    function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    function applyLook() {
      look = LOOKS[settings.look] || LOOKS[0];
      for (var i = 0; i < 6; i++) { var c = hex(look.pal[i]); palF[i * 3] = c[0]; palF[i * 3 + 1] = c[1]; palF[i * 3 + 2] = c[2]; }
      ground = hex(look.ground); canvasCol = hex(look.canvas);
    }
    applyLook();
    function set(o) {
      if (o && !dead) {
        Object.keys(ranges).forEach(function (k) { if (Number.isFinite(o[k])) settings[k] = clamp(o[k], ranges[k][0], ranges[k][1]); });
        if (Number.isFinite(o.look)) { var nl = clamp(Math.round(o.look), 0, LOOKS.length - 1); if (nl !== settings.look) { settings.look = nl; applyLook(); } }
      }
      return Object.assign({}, settings);
    }

    // ---------------------------------------------------------------- inputs
    function readHands(dt) {
      var f = kit.fingers, stamp = Date.now(), pts = null, fresh = false;
      if (f) {
        fresh = Number.isFinite(f.t) && stamp - f.t >= -34 && stamp - f.t < 600;
        if (fresh && f.t > lastFinger && Array.isArray(f.pts)) { lastFinger = f.t; pts = f.pts.filter(valid).slice(0, MAX_HANDS); }
      } else if (kit.touches) {
        var touches = kit.touches.filter(function (t) { return t && Number.isFinite(t.t) && stamp - t.t >= 0 && stamp - t.t < 180 && valid([t.x, t.y]); });
        var newest = touches.reduce(function (m, t) { return Math.max(m, t.t); }, -Infinity);
        if (newest > lastFinger) { lastFinger = newest; pts = touches.slice(0, MAX_HANDS).map(function (t) { return [t.x, t.y]; }); }
        fresh = touches.length > 0;
      }
      if (pts !== null) {
        // A distant stray detection starts its own brush rather than resetting a held pour.
        var used = new Set(), assigned = new Set(), pairs = [];
        hands.forEach(function (h, hi) { pts.forEach(function (p, pi) { var d = Math.hypot(p[0] - h.x, p[1] - h.y); if (d < 0.08) pairs.push({d: d, hi: hi, pi: pi}); }); });
        pairs.sort(function (a, b) { return a.d - b.d; });
        pairs.forEach(function (q) {
          if (used.has(q.hi) || assigned.has(q.pi)) return;
          used.add(q.hi); assigned.add(q.pi);
          var h = hands[q.hi], xy = pts[q.pi], gap = time - h.seen, el = clamp(gap, 1 / 120, 0.15);
          var vx = (xy[0] - h.x) / el, vy = (xy[1] - h.y) / el, sp = Math.hypot(vx, vy);
          if (gap > 0.12) { vx = vy = sp = 0; }                      // reacquisition never spikes
          h.vx += (vx - h.vx) * 0.5; h.vy += (vy - h.vy) * 0.5; h.speed += (sp - h.speed) * 0.5;
          h.x = xy[0]; h.y = xy[1]; h.seen = time; h.age += gap;
          // Position in a small neighbourhood is a hold even when Kinect points jitter.
          // Frame-to-frame speed made a stationary real hand reset the pour every packet.
          if (Math.hypot((h.x-h.ax)*aspect,h.y-h.ay) < 0.035) h.still += gap;
          else { if (h.still > 0.45) stats.pours++; h.still = 0; h.ax=h.x; h.ay=h.y; if (!h.stroked && h.age > 0.25) { h.stroked = true; stats.strokes++; } }
        });
        pts.forEach(function (p, pi) {
          if (assigned.has(pi) || hands.length >= MAX_HANDS) return;
          hands.push({id: nextId++, x: p[0], y: p[1], ax:p[0], ay:p[1], vx: 0, vy: 0, speed: 0, seen: time, age: 0, still: 0, pig: pigment % 6, stroked: false});
          pigment++; stats.dabs++;
        });
      }
      // Match the measured wall gaps: a held finger was missing for up to 530 ms.
      hands = hands.filter(function (h) { return fresh && time - h.seen < 0.6; });
      if (hands.length) lastContact = time;
    }
    function readBody(dt, now) {
      var fresh = body.update(dt, now), people = [];
      if (body.fresh && body.regOk) body.people.slice(0, MAXP).forEach(function (p) {
        var xy = kit.toScreen(p.cx * 512, p.cy * 424); if (!valid(xy)) return;
        var key = 'v2:' + p.id, prev = actors.get(key), vx = 0, vy = 0;
        if (prev) { var gap = (now - prev.now) / 1000; if (gap > 0 && gap < 0.25) { vx = clamp((xy[0] - prev.x) / gap, -2, 2); vy = clamp((xy[1] - prev.y) / gap, -2, 2); } vx = prev.vx + (vx - prev.vx) * 0.4; vy = prev.vy + (vy - prev.vy) * 0.4; }
        actors.set(key, {x: xy[0], y: xy[1], vx: vx, vy: vy, now: now});
        var rad = clamp(Math.sqrt(p.area / (BW * BH)) * 1.6, 0.08, 0.4), mv = clamp(p.moving * 3, 0, 1);
        if (mv > 0.1 && Math.hypot(vx, vy) > 0.05) stats.smears++;
        people.push({x: xy[0] * aspect, y: xy[1], vx: vx * aspect, vy: vy, r: rad, mv: mv});
      });
      actors.forEach(function (a, k) { if (now - a.now > 300) actors.delete(k); });
      if (fresh || !body.fresh) {
        var mask = body.mask, sdf = body.sdf;
        for (var i = 0; i < BW * BH; i++) {
          var m = mask[i], s = sdf[i];
          bodyU8[i * 2] = (Number.isFinite(m) ? clamp(m, 0, 1) : 0) * 255;
          bodyU8[i * 2 + 1] = (Number.isFinite(s) ? clamp((s + 8) / 32, 0, 1) : 1) * 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, btex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
      }
      return people;
    }
    function readRoom(dt) {
      var room = kit.room ? kit.room(dt) : null;   // exactly once per frame
      roomNow = room;
      var tx = 0, ty = 0, motion = 0, present = false;
      if (room && room.enabled && room.fresh && room.present) {
        present = true; motion = clamp(Number.isFinite(room.motion) ? room.motion : 0, 0, 1);
        if (room.positioned && Number.isFinite(room.x) && Number.isFinite(room.y)) { tx = clamp(room.x, -1, 1) * 0.05; ty = clamp(room.y, -1, 1) * 0.03; }
      }
      var k = 1 - Math.exp(-dt / 0.6);
      var moved = Math.abs(tx - tilt[0]) > 1e-4;
      tilt[0] += (tx - tilt[0]) * k; tilt[1] += (ty - tilt[1]) * k;
      if (moved && Math.abs(tilt[0]) > 0.005) stats.roomTilts++;
      roomMotion += (motion - roomMotion) * (1 - Math.exp(-dt / 0.35));
      turb = roomMotion * 0.03;
      return present;
    }
    function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
    function dripPig() {        // a drip needs to show against the ground: skip pigments that vanish on it (ivory black on charcoal, white on cream)
      for (var k = 0; k < 6; k++) { var i = (pigment + k) % 6; if (Math.abs(lum(hex(look.pal[i])) - lum(ground)) > 0.18) { pigment += k + 1; return i; } }
      return (pigment++) % 6;
    }
    function spawnDrip(fromCenter) {
      if (drips.filter(function (d) { return !d.prime; }).length >= MAX_DRIPS || reduced) return;
      var d;
      if (fromCenter) { var a = random() * TAU, sp = 0.12 + random() * 0.14; d = {x: 0.5 + Math.cos(a) * 0.04 / aspect, y: 0.5 + Math.sin(a) * 0.04, vx: Math.cos(a) * sp / aspect, vy: Math.sin(a) * sp, life: 1.3 + random() * 0.8}; }
      else d = {x: 0.08 + random() * 0.84, y: -0.01, vx: (random() - 0.5) * 0.04, vy: 0.16 + random() * 0.14, life: 1.8 + random() * 1.0};
      d.age = 0; d.pig = dripPig(); d.r = 0.016 + random() * 0.012; drips.push(d); stats.drips++;
    }
    function prime() {
      var n = 5 + Math.floor(random() * 3);
      for (var i = 0; i < n; i++) {
        var fromCenter = look.drip === 'center', a = random() * TAU, rr = fromCenter ? 0.05 + random() * 0.3 : 0;
        var x = fromCenter ? 0.5 + Math.cos(a) * rr / aspect : 0.12 + random() * 0.76, y = fromCenter ? 0.5 + Math.sin(a) * rr : 0.15 + random() * 0.7;
        drips.push({x: x, y: y, vx: 0, vy: 0, life: 1.2 + random() * 1.4, age: 0, pig: (pigment + i) % 6, r: 0.035 + random() * 0.05, prime: true});
      }
      pigment += n; primedAt = time;
    }
    function stepDrips(dt) {
      drips.forEach(function (d) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += (look.drip === 'center' ? 0 : 0.08) * dt; });
      drips = drips.filter(function (d) { return d.age < d.life && d.y < 1.05 && d.y > -0.05 && d.x > -0.05 && d.x < 1.05; });
    }
    function packBrushes() {
      BA.fill(0); BB.fill(0);
      var n = 0;
      hands.forEach(function (h) {
        if (n >= MAXB) return;
        var pour = clamp((h.still - 0.15) / 3.5, 0, 1), j = n * 4;
        var rad = (0.048 + Math.sqrt(pour) * 0.16) * (0.6 + 0.4 * settings.flow) + 0.008;
        BA[j] = h.x * aspect; BA[j + 1] = 1 - h.y; BA[j + 2] = h.vx * aspect; BA[j + 3] = -h.vy;
        BB[j] = rad; BB[j + 1] = (0.9 + Math.min(3.5, h.speed * 5) + pour * 3.2) * (0.6 + 0.4 * settings.thick); BB[j + 2] = h.pig; BB[j + 3] = pour * 0.065 + 0.004;
        n++;
      });
      drips.forEach(function (d) {
        if (n >= MAXB) return;
        var j = n * 4, fade = 1 - d.age / d.life;
        BA[j] = d.x * aspect; BA[j + 1] = 1 - d.y; BA[j + 2] = d.vx * aspect; BA[j + 3] = -d.vy;
        BB[j] = d.r; BB[j + 1] = (d.prime ? 1.0 : 1.3) * fade; BB[j + 2] = d.pig; BB[j + 3] = d.prime ? 0.01 : 0.003;
        n++;
      });
      return n;
    }
    function packPeople(people) {
      PA.fill(0); PB.fill(0);
      people.forEach(function (p, i) { PA[i * 4] = p.x; PA[i * 4 + 1] = 1 - p.y; PA[i * 4 + 2] = p.vx; PA[i * 4 + 3] = -p.vy; PB[i * 2] = p.r; PB[i * 2 + 1] = p.mv; });
      return people.length;
    }

    // ---------------------------------------------------------------- frame
    function frame(dt, now) {
      if (dead) return;
      var at = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      if (canvas.width !== W || canvas.height !== H) buildSim();
      readHands(dt);
      var people = readBody(dt, now);
      var roomPresent = readRoom(dt);
      var bodyOn = body.fresh && body.regOk && body.present;
      var occupied = hands.length > 0 || bodyOn || roomPresent;
      if (occupied) occupiedAt = time;
      var sinceOcc = time - occupiedAt;
      // wetness: paint keeps creeping while someone is around; it dries over the Drying knob's seconds once everyone is gone
      var wetTarget = occupied ? 1 : clamp(1 - sinceOcc / settings.dry, 0, 1);
      wet += (wetTarget - wet) * (1 - Math.exp(-dt / 0.5));
      var wetTau = look.wet * (settings.dry / 10) * (0.25 + 0.75 * wet) * clamp(settings.flow, 0.2, 2);
      var damp = Math.exp(-dt / Math.max(0.12, wetTau));
      var fade = sinceOcc > 25 ? Math.exp(-dt / 140) : 1;
      // drips from room motion, an idle dab now and then so the canvas never freezes
      if (roomMotion > 0.12 && wet > 0.3) { dripBudget += dt * (0.4 + roomMotion * 2.2); if (dripBudget > 1) { dripBudget = 0; spawnDrip(look.drip === 'center'); } }
      else dripBudget = Math.max(0, dripBudget - dt);
      idleDab -= dt;
      if (idleDab <= 0) { idleDab = 5 + random() * 6; if (!reduced && hands.length === 0 && !bodyOn) { spawnDrip(look.drip === 'center'); } }
      if (frames === 2 || (sinceOcc > 170 && time - primedAt > 200)) prime();
      stepDrips(dt);
      var nb = packBrushes(), np = packPeople(people);
      var calm = reduced ? 0.3 : 1;

      gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      // 1. velocity
      var nxt = 1 - cur;
      gl.useProgram(PV.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fvel[nxt]); gl.viewport(0, 0, SW, SH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel[cur]); gl.uniform1i(PV.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pB[cur]); gl.uniform1i(PV.u.uPaintB, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, btex); gl.uniform1i(PV.u.uBody, 2);
      gl.uniformMatrix3fv(PV.u.uHinv, false, body.hinv());
      gl.uniform2f(PV.u.uTexel, 1 / SW, 1 / SH);
      gl.uniform1f(PV.u.uDt, dt); gl.uniform1f(PV.u.uTime, time); gl.uniform1f(PV.u.uAspect, aspect); gl.uniform1f(PV.u.uDamp, damp);
      gl.uniform1f(PV.u.uDrift, (look.drift * calm + turb) * wet * settings.flow); gl.uniform1f(PV.u.uNoise, look.noise);
      gl.uniform1f(PV.u.uRadial, look.radial * wet * settings.flow * (0.6 + roomMotion)); gl.uniform1f(PV.u.uSwirl, look.swirl * wet * calm);
      gl.uniform1f(PV.u.uSpread, look.spread * wet * settings.flow); gl.uniform1f(PV.u.uBodyPush, bodyOn ? 0.035 * wet : 0); gl.uniform1f(PV.u.uVmax, 0.12);
      gl.uniform2f(PV.u.uGravity, tilt[0] * wet * settings.flow, -tilt[1] * wet * settings.flow);
      gl.uniform4fv(PV.u.uBA, BA); gl.uniform4fv(PV.u.uBB, BB); gl.uniform1i(PV.u.uNB, nb);
      gl.uniform4fv(PV.u.uPA, PA); gl.uniform2fv(PV.u.uPB, PB); gl.uniform1i(PV.u.uNP, np);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (bodyOn) stats.bodyPushFrames++;
      // 2. paint (two targets)
      gl.useProgram(PP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fpaint[nxt]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel[nxt]); gl.uniform1i(PP.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pA[cur]); gl.uniform1i(PP.u.uPaintA, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pB[cur]); gl.uniform1i(PP.u.uPaintB, 2);
      gl.uniform1f(PP.u.uDt, dt); gl.uniform1f(PP.u.uTime, time); gl.uniform1f(PP.u.uAspect, aspect); gl.uniform1f(PP.u.uFade, fade); gl.uniform1f(PP.u.uSnap, look.snap);
      gl.uniform4fv(PP.u.uBA, BA); gl.uniform4fv(PP.u.uBB, BB); gl.uniform1i(PP.u.uNB, nb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = nxt;
      // 3. the wall
      gl.useProgram(PS.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel[cur]); gl.uniform1i(PS.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pA[cur]); gl.uniform1i(PS.u.uPaintA, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pB[cur]); gl.uniform1i(PS.u.uPaintB, 2);
      gl.uniform2f(PS.u.uTexel, 1 / SW, 1 / SH); gl.uniform1f(PS.u.uAspect, aspect);
      gl.uniform1f(PS.u.uThick, settings.thick); gl.uniform1f(PS.u.uGloss, look.gloss * settings.gloss); gl.uniform1f(PS.u.uGrain, look.grain);
      gl.uniform1f(PS.u.uBright, settings.brightness); gl.uniform1f(PS.u.uTondo, look.tondo); gl.uniform1f(PS.u.uWet, wet);
      gl.uniform3f(PS.u.uGround, ground[0], ground[1], ground[2]); gl.uniform3f(PS.u.uCanvas, canvasCol[0], canvasCol[1], canvasCol[2]);
      gl.uniform3fv(PS.u.uPal, palF);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mixTex); gl.uniform1i(PS.u.uMixLut, 3);
      gl.uniform1f(PS.u.uNatural, look.natural || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
      frameMs = performance.now() - at;
      if (window.WallTest && out && time - lastNote >= 2) { lastNote = time; try { console.warn('acrylic debug ' + JSON.stringify(debug())); } catch (e) {} }
    }
    function debug() {
      var r = roomNow || {};
      return {look: look.name, natural: !!look.natural, hands: hands.length, heldSeconds: hands.map(function(h){return +h.still.toFixed(3);}), drips: drips.length, people: actors.size, bodyOn: !!(body.fresh && body.regOk && body.present), reg: body.regOk,
        room: {enabled: !!r.enabled, fresh: !!r.fresh, present: !!r.present, positioned: !!r.positioned, x: +(r.x || 0).toFixed(3), motion: +(r.motion || 0).toFixed(3)},
        tilt: [+tilt[0].toFixed(4), +tilt[1].toFixed(4)], turb: +turb.toFixed(4), wet: +wet.toFixed(3), frameMs: +frameMs.toFixed(2), sim: [SW, SH], stats: stats};
    }
    function destroy() {
      dead = true;
      kit.wantDepth(false);
      if (window.AcrylicSet === set) delete window.AcrylicSet;
      made.reverse().forEach(function (m) { try { gl['delete' + m[0]](m[1]); } catch (e) {} });
      made = [];
    }
    kit.wantDepth(true);
    window.AcrylicSet = set; if (window._acrylicFx) set(window._acrylicFx);
    out = {frame: frame, touch: function () { /* kit.fingers is authoritative; kit.touches is the sparse fallback inside readHands */ }, destroy: destroy, debug: debug};
    return out;
  }
})();
