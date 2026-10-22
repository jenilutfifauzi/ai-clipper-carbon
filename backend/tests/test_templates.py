"""Templates (.scratch/templates/issues/01-tracer-save-and-apply-layers.md; docs/adr/0023): a
Candidate's layers saved with their Anchors, and put on Candidates of other lengths.

Seam B on the pure `capture` and `apply`, then Seam A through the API and MCP."""

import json
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.audio_effects import AudioEffect
from app.candidates import (
    WHOLE,
    Adjust,
    AdjustmentLayer,
    CueEdit,
    Framing,
    Grade,
    Keyframe,
    Layout,
    MusicClip,
    Segment,
    Shape,
    ShapeStyle,
    TextLayer,
    Transform,
    Transition,
    TransitionKind,
    WordEdit,
    manual_candidate,
)
from app.templates import (
    Anchor,
    AnchorKind,
    AnchorOverride,
    Boundaries,
    Boundary,
    Edge,
    InvalidTemplate,
    LayerKind,
    Template,
    TemplatePart,
    Treatment,
    apply,
    boundaries,
    capture,
)
from app.api import POSTER_SIZE, POSTERS_DIR
from app.jobs import CANDIDATES_FILE
from app.styles import StyleOverrides
from app.video_effects import VideoEffect
from fontfiles import font_file
from test_fonts import imported as imported_face
from test_imported_looks import imported as imported_look
from test_jobs_api import create_job
from test_media_library import upload as upload_media
from test_render import preview
from test_watermark import red_logo  # noqa: F401 (fixture)
from test_watermark import upload as upload_logo
from test_mcp import HALO_KABAR, anyio_backend, call, fails, make, manual, mcp, reviewed  # noqa: F401 (fixtures)
from test_render import probe
from test_review import candidates, patch
from test_save_frame import pixels_of
from test_selection import analyzed, clip

SONG = "a" * 32
STING = "b" * 32
CARD = "c" * 32
NOW = datetime(2026, 10, 22, tzinfo=UTC)


def candidate(secs: float, **edits):
    """A Candidate whose Clip lasts `secs`, uncut: its Main Slot is the whole Clip."""
    return replace(manual_candidate(f"c{secs:g}", 100.0, 100.0 + secs), **edits)


def lower_third(**fields) -> TextLayer:
    return TextLayer(**{"id": "name", "text": "Jeni", "start": 2.0, "secs": 3.0, **fields})


def call_to_action(**fields) -> TextLayer:
    return TextLayer(**{"id": "cta", "text": "Follow", "start": 14.0, "secs": 4.0, **fields})


def bed(**fields) -> MusicClip:
    return MusicClip(**{"id": "bed", "media": SONG, "start": 0.0, "secs": 20.0, **fields})


def template_of(layers) -> Template:
    return Template("brand", "Brand", NOW, NOW, layers)


def video(segment_id: str, media: str, secs: float, **fields) -> Segment:
    """A Segment of a Media Library video, its first `secs` seconds (from `start`, when given)."""
    start = fields.pop("start", 0.0)
    return Segment(segment_id, start, start + secs, media=media, framing=Framing(), **fields)


def wrapped(secs: float, intro: float = 3.0, outro: float = 2.0, **edits):
    """A Candidate whose Main Slot (one Segment of the Source) lasts `secs`, with an intro sting
    `intro` long and an end card `outro` long; none where 0."""
    track = [
        *([video("sting", STING, intro)] if intro else []),
        Segment("s1", 100.0, 100.0 + secs),
        *([video("card", CARD, outro)] if outro else []),
    ]
    return candidate(secs, segments=track, **edits)


def saved_from(source, overrides=(), template_id: str = "brand") -> Template:
    """The Template `capture` makes of `source`, as the store would save it."""
    return Template(template_id, template_id.title(), NOW, NOW, **capture(source, overrides).contents())


def anchor_of(layers, kind: LayerKind, item_id: str) -> Anchor:
    [anchor] = [layer.anchor for listed_kind, layer in layers.items() if (listed_kind, layer.item.id) == (kind, item_id)]
    return anchor


# Capture


def test_each_edge_hangs_from_its_nearest_boundary():
    middle = TextLayer("middle", "Halo", start=8.0, secs=3.0)
    captured = capture(candidate(20, text_layers=[lower_third(), call_to_action(), middle], music=[bed()]))

    layers = captured.layers
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "name") == Anchor(Edge(Boundary.MAIN_START, 2.0), Edge(Boundary.MAIN_START, 5.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "cta") == Anchor(Edge(Boundary.MAIN_END, -6.0), Edge(Boundary.MAIN_END, -2.0))
    assert anchor_of(layers, LayerKind.MUSIC, "bed") == Anchor(Edge(Boundary.MAIN_START, 0.0), Edge(Boundary.MAIN_END, 0.0))
    # Each edge on its own: nearer the start at 8 s, nearer the end at 11 s.
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "middle") == Anchor(Edge(Boundary.MAIN_START, 8.0), Edge(Boundary.MAIN_END, -9.0))
    assert [anchor_of(layers, kind, item_id).kind for kind, item_id in (
        (LayerKind.TEXT_LAYERS, "name"), (LayerKind.TEXT_LAYERS, "cta"), (LayerKind.MUSIC, "bed"),
    )] == [AnchorKind.START, AnchorKind.END, AnchorKind.SPAN]
    assert captured.notices == []


def test_a_start_end_or_span_override_is_stored_as_its_edges():
    middle = TextLayer("middle", "Halo", start=8.0, secs=3.0)
    overrides = [
        AnchorOverride(LayerKind.TEXT_LAYERS, "name", AnchorKind.END),
        AnchorOverride(LayerKind.TEXT_LAYERS, "cta", AnchorKind.START),
        AnchorOverride(LayerKind.TEXT_LAYERS, "middle", AnchorKind.START),
        AnchorOverride(LayerKind.MUSIC, "bed", AnchorKind.SPAN),
    ]
    layers = capture(candidate(20, text_layers=[lower_third(), call_to_action(), middle], music=[bed()]), overrides).layers

    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "name") == Anchor(Edge(Boundary.MAIN_END, -18.0), Edge(Boundary.MAIN_END, -15.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "cta") == Anchor(Edge(Boundary.MAIN_START, 14.0), Edge(Boundary.MAIN_START, 18.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "middle") == Anchor(Edge(Boundary.MAIN_START, 8.0), Edge(Boundary.MAIN_START, 11.0))
    assert anchor_of(layers, LayerKind.MUSIC, "bed") == Anchor(Edge(Boundary.MAIN_START, 0.0), Edge(Boundary.MAIN_END, 0.0))


def test_an_override_of_a_layer_the_candidate_hasnt_is_refused():
    with pytest.raises(ValueError, match="no Text Layer gone"):
        capture(candidate(20), [AnchorOverride(LayerKind.TEXT_LAYERS, "gone", AnchorKind.END)])


def test_music_clips_of_the_sources_sound_are_left_out_with_a_notice():
    episode = MusicClip("voice", start=0.0, secs=5.0, offset=300.0)
    captured = capture(candidate(20, music=[episode, bed(detached_from="main")]))

    assert [layer.item.id for layer in captured.layers.music] == ["bed"]
    # A Template's song is no longer Detached from a Segment of the Candidate it was saved from.
    assert captured.layers.music[0].item.detached_from is None
    assert captured.notices == ["1 Music Clip of the episode's sound left out: a Template plays only Media Library items."]


def test_every_kind_of_layer_is_captured():
    shape = Shape("plate", start=1.0, secs=2.0, style=ShapeStyle(fill="#000000"))
    adjust = AdjustmentLayer("warm", start=0.0, secs=20.0)
    layers = capture(candidate(20, shapes=[shape], adjustment_layers=[adjust])).layers

    assert [(kind, layer.item.id) for kind, layer in layers.items()] == [(LayerKind.SHAPES, "plate"), (LayerKind.ADJUSTMENT_LAYERS, "warm")]


# Apply


@pytest.mark.parametrize("secs", [20, 75])
def test_a_start_lower_third_and_an_end_call_to_action_keep_their_distances(secs):
    template = template_of(capture(candidate(20, text_layers=[lower_third(), call_to_action()])).layers)

    applied = apply(template, candidate(secs))

    name, cta = applied.change.text_layers
    assert (name.start, name.secs) == (2.0, 3.0)
    assert (cta.start, cta.secs) == (secs - 6.0, 4.0)
    assert applied.notices == []


@pytest.mark.parametrize("secs", [20, 75])
def test_a_span_layer_stretches_to_cover_the_main_slot(secs):
    adjust = AdjustmentLayer("warm", start=0.0, secs=20.0, fade_in=1.0, fade_out=1.0)
    template = template_of(capture(candidate(20, music=[bed()], adjustment_layers=[adjust])).layers)

    applied = apply(template, candidate(secs))

    [song] = applied.change.music
    [warm] = applied.change.adjustment_layers
    assert (song.start, song.secs, song.offset) == (0.0, secs, 0.0)
    assert (warm.start, warm.secs, warm.fade_in, warm.fade_out) == (0.0, secs, 1.0, 1.0)


def test_applied_layers_carry_the_templates_mark_and_hand_made_ones_are_kept():
    template = template_of(capture(candidate(20, text_layers=[lower_third()], music=[bed()])).layers)
    mine = TextLayer("name", "Mine", start=10.0, secs=2.0)

    applied = apply(template, candidate(30, text_layers=[mine]))

    assert [(layer.id, layer.text, layer.template) for layer in applied.change.text_layers] == [
        ("name", "Mine", None),
        # A new id where the Candidate has the Template's own.
        ("name-2", "Jeni", "brand"),
    ]
    assert [clip.template for clip in applied.change.music] == ["brand"]
    # The Template's own layers are kept unmarked.
    assert all(layer.item.template is None for _, layer in template.layers.items())


def test_applying_again_replaces_the_template_items_rather_than_doubling_them():
    template = template_of(capture(candidate(20, text_layers=[lower_third()], music=[bed()])).layers)
    mine = TextLayer("mine", "Mine", start=10.0, secs=2.0)
    once = apply(template, candidate(30, text_layers=[mine])).change

    twice = apply(template, candidate(30, text_layers=once.text_layers, music=once.music), {"brand": template})

    assert [(layer.id, layer.template) for layer in twice.change.text_layers] == [("mine", None), ("name", "brand")]
    assert [(clip.id, clip.template) for clip in twice.change.music] == [("bed", "brand")]
    # Nothing was changed by hand since: nothing to tell.
    assert twice.notices == []


def test_applying_another_template_replaces_the_first_ones_items():
    first = template_of(capture(candidate(20, text_layers=[lower_third()], music=[bed()])).layers)
    other = Template("other", "Other", NOW, NOW, capture(candidate(20, text_layers=[call_to_action()])).layers)
    mine = TextLayer("mine", "Mine", start=10.0, secs=2.0)
    once = apply(first, candidate(30, text_layers=[mine])).change

    applied = apply(other, candidate(30, text_layers=once.text_layers, music=once.music), {"brand": first, "other": other})

    assert [(layer.id, layer.template) for layer in applied.change.text_layers] == [("mine", None), ("cta", "other")]
    assert applied.change.music == []
    assert applied.notices == []


def test_a_template_item_changed_by_hand_is_counted_and_replaced():
    template = template_of(capture(candidate(20, text_layers=[lower_third(), call_to_action()])).layers)
    name, cta = apply(template, candidate(30)).change.text_layers
    moved = replace(name, start=name.start + 1.5)

    applied = apply(template, candidate(30, text_layers=[moved, cta]), {"brand": template})

    assert [(layer.id, layer.start, layer.template) for layer in applied.change.text_layers] == [
        ("name", 2.0, "brand"), ("cta", 24.0, "brand"),
    ]
    assert applied.notices == ["1 Template item changed by hand replaced."]


def test_the_items_of_a_deleted_template_all_count_as_replaced():
    template = template_of(capture(candidate(20, text_layers=[lower_third(), call_to_action()])).layers)
    once = apply(template, candidate(30)).change

    applied = apply(template, candidate(30, text_layers=once.text_layers))

    assert [layer.id for layer in applied.change.text_layers] == ["name", "cta"]
    assert applied.notices == ["2 Template items of a deleted Template replaced."]


def test_no_template_removes_the_template_items_and_nothing_else():
    template = template_of(capture(candidate(20, text_layers=[lower_third()], music=[bed()])).layers)
    mine = TextLayer("mine", "Mine", start=10.0, secs=2.0)
    plate = Shape("plate", start=0.0, secs=30.0, style=ShapeStyle(fill="#000000"))
    branded = candidate(30, text_layers=[mine], shapes=[plate])
    once = apply(template, branded).change
    name = next(layer for layer in once.text_layers if layer.template)

    applied = apply(None, candidate(30, text_layers=[*once.text_layers[:1], replace(name, text="Changed")], shapes=[plate], music=once.music), {"brand": template})

    assert applied.change.text_layers == [mine]
    assert applied.change.shapes == [plate]
    assert applied.change.music == []
    assert applied.notices == ["1 Template item changed by hand removed."]


def test_a_layer_past_a_short_clips_end_is_trimmed_there_or_left_out():
    keyed = lower_third(keys={"opacity": [Keyframe(0.0, 1.0), Keyframe(3.0, 0.0)]})
    template = template_of(capture(candidate(20, text_layers=[keyed, TextLayer("late", "Late", start=6.0, secs=2.0)])).layers)

    applied = apply(template, candidate(3))

    [name] = applied.change.text_layers
    assert (name.start, name.secs) == (2.0, 1.0)
    # Its Keyframes follow the cut, as the Clipboard's do.
    assert [key.at for key in name.keys["opacity"]] == [0.0, 1.0]
    assert applied.notices == ["1 layer cut short to fit; 1 left out, falling outside the clip."]


# Lengths that don't fit (.scratch/templates/issues/05-lengths-that-dont-fit.md)


@pytest.mark.parametrize("secs", [20, 75])
def test_a_span_lower_thirds_fades_keep_their_distances_from_its_nearer_edge(secs):
    # From 2 s in to 2 s before the end of a 40 s Clip, faded in over its first 0.5 s and out over its last.
    fades = {"opacity": [Keyframe(0.0, 0.0), Keyframe(0.5, 1.0), Keyframe(35.5, 1.0), Keyframe(36.0, 0.0)]}
    source = candidate(40, text_layers=[lower_third(secs=36.0, keys=fades)])
    template = saved_from(source, [AnchorOverride(LayerKind.TEXT_LAYERS, "name", AnchorKind.SPAN)])

    applied = apply(template, candidate(secs))

    [name] = applied.change.text_layers
    assert (name.start, name.secs) == (2.0, secs - 4.0)
    assert [(key.at, key.value) for key in name.keys["opacity"]] == [(0.0, 0.0), (0.5, 1.0), (secs - 4.5, 1.0), (secs - 4.0, 0.0)]
    assert applied.notices == []


def test_a_span_music_beds_volume_keyframes_keep_their_distances_from_its_nearer_edge():
    ducked = {"volume": [Keyframe(1.0, 1.0), Keyframe(17.0, 1.0), Keyframe(20.0, 0.0)]}
    template = saved_from(candidate(20, music=[bed(keys=ducked)]))

    [song] = apply(template, candidate(75), lengths={SONG: 300.0}).change.music

    assert song.secs == 75.0
    assert [(key.at, key.value) for key in song.keys["volume"]] == [(1.0, 1.0), (72.0, 1.0), (75.0, 0.0)]


def test_a_shortened_span_leaves_out_the_keyframes_passing_its_new_middle():
    keys = {"opacity": [Keyframe(0.0, 0.0), Keyframe(3.0, 1.0), Keyframe(13.0, 1.0), Keyframe(16.0, 0.0)]}
    template = saved_from(candidate(20, text_layers=[lower_third(secs=16.0, keys=keys)]), [AnchorOverride(LayerKind.TEXT_LAYERS, "name", AnchorKind.SPAN)])

    # 1 s long: its middle at 0.5 s, each half's Keyframe nearer its edge kept.
    [name] = apply(template, candidate(5)).change.text_layers

    assert [(key.at, key.value) for key in name.keys["opacity"]] == [(0.0, 0.0), (1.0, 0.0)]


@pytest.mark.parametrize(("speed", "offset", "stops"), [(1.0, 0.0, 30.0), (2.0, 0.0, 15.0), (1.0, 5.0, 25.0)])
def test_a_30_s_song_as_a_span_on_a_75_s_candidate_stops_where_it_ends(speed, offset, stops):
    ducked = {"volume": [Keyframe(0.0, 1.0), Keyframe(20.0, 0.5)]}
    template = saved_from(candidate(20, music=[bed(speed=speed, offset=offset, keys=ducked, fade_out=2.0)]))

    applied = apply(template, candidate(75), lengths={SONG: 30.0})

    [song] = applied.change.music
    assert (song.start, song.secs, song.offset, song.fade_out) == (0.0, stops, offset, 2.0)
    # Never looped; its volume Keyframes cut where it stops.
    assert song.keys["volume"][-1].at == stops
    assert applied.notices == ["1 Music Clip stopped at its song's end: a song never loops."]


def test_a_song_not_in_the_lengths_given_is_left_as_long_as_its_anchor_makes_it():
    template = saved_from(candidate(20, music=[bed()]))

    applied = apply(template, candidate(75))

    assert [song.secs for song in applied.change.music] == [75.0]
    assert applied.notices == []


def test_reapplying_a_clamped_song_counts_nothing_changed_by_hand():
    template = saved_from(candidate(20, music=[bed()]))
    once = apply(template, candidate(75), lengths={SONG: 30.0}).change

    again = apply(template, candidate(75, music=once.music), {"brand": template}, lengths={SONG: 30.0})

    assert again.notices == ["1 Music Clip stopped at its song's end: a song never loops."]


def test_end_layers_on_a_5_s_candidate_are_trimmed_or_left_out():
    credits = TextLayer("credits", "Credits", start=12.0, secs=2.95)
    template = saved_from(candidate(20, text_layers=[call_to_action(), credits]))
    assert {layer.anchor.kind for _, layer in template.layers.items()} == {AnchorKind.END}

    applied = apply(template, candidate(5))

    # The call to action, 6 s to 2 s before the end, is cut at the Clip's start; the credits, ending
    # 5.05 s before it, fall wholly outside.
    [cta] = applied.change.text_layers
    assert (cta.id, cta.start, cta.secs) == ("cta", 0.0, 3.0)
    assert applied.notices == ["1 layer cut short to fit; 1 left out, falling outside the clip."]


def test_a_span_whose_edges_cross_on_a_short_candidate_is_left_out():
    template = saved_from(candidate(20, text_layers=[lower_third(secs=16.0)]), [AnchorOverride(LayerKind.TEXT_LAYERS, "name", AnchorKind.SPAN)])

    applied = apply(template, candidate(3))

    # From 2 s in to 2 s before the end: on 3 s, its end comes before its start.
    assert applied.change.text_layers == []
    assert applied.notices == ["1 Span left out: its edges cross on this clip."]


def test_applying_a_template_to_the_candidate_it_was_saved_from_keeps_its_layers_times():
    # The editor keeps times to the hundredth, a Clip's length to the ms: a bed under the whole of a
    # 65.926 s Clip is 65.93 s long, 4 ms past its end.
    source = replace(manual_candidate("c1", 2680.002, 2745.928), music=[bed(secs=65.93, offset=11.63, fade_out=4.2)])
    assert source.duration == 65.926
    template = saved_from(source)

    applied = apply(template, source, lengths={SONG: 77.56})

    [song] = [clip for clip in applied.change.music if clip.template]
    assert (song.start, song.secs, song.offset, song.fade_out) == (0.0, 65.93, 11.63, 4.2)
    assert applied.notices == []


# Intro, outro and the Main Slot


def test_the_intro_and_outro_are_split_off_with_their_transitions_and_media_edits():
    track = [
        video("sting", STING, 2.0), video("logo", STING, 1.0, start=2.0),
        Segment("s1", 100.0, 110.0), video("broll", CARD, 2.0), Segment("s2", 120.0, 130.0),
        video("card", CARD, 2.0),
    ]
    transitions = [
        Transition("sting", TransitionKind.WIPELEFT, 0.3), Transition("logo", secs=0.5),
        Transition("s1", secs=0.2), Transition("s2", TransitionKind.DIPCOLOUR, 0.4),
    ]
    edits = [WordEdit(1.0, "Halo", media=STING), WordEdit(105.0, "Kabar"), WordEdit(1.5, "Mampir", media=CARD)]
    captured = capture(candidate(30, segments=track, transitions=transitions, word_edits=edits, cue_edits=[CueEdit(1.0, media=STING, shift=0.1)]))

    assert [segment.id for segment in captured.intro.segments] == ["sting", "logo"]
    assert (captured.intro.transitions, captured.intro.join) == ([transitions[0]], transitions[1])
    assert ([segment.id for segment in captured.outro.segments], captured.outro.transitions) == (["card"], [])
    assert captured.outro.join == transitions[3]
    # The edits of the intro's and outro's videos only, not the Source's.
    assert captured.word_edits == [edits[0], edits[2]]
    assert captured.cue_edits == [CueEdit(1.0, media=STING, shift=0.1)]
    assert (captured.intro.secs, captured.outro.secs) == (2.7, 2.0)
    assert captured.notices == ["1 media Segment between the episode's Segments left out: a Template's Main Slot is each Candidate's own."]


def test_a_candidate_without_a_segment_of_the_source_is_refused():
    with pytest.raises(InvalidTemplate, match="Segment of the episode"):
        capture(candidate(20, segments=[video("sting", STING, 3.0)]))


def test_boundaries_are_measured_with_the_transitions_overlaps():
    source = wrapped(20, transitions=[Transition("sting", secs=1.0), Transition("s1", secs=0.5)])

    assert boundaries(source) == Boundaries(0.0, 2.0, 22.0, 23.5)


def test_the_hook_is_kept_by_its_distance_from_the_main_slots_start_and_its_length():
    template = saved_from(wrapped(20, hook_start=3.5, hook_secs=2.5))

    assert (template.hook_offset, template.hook_secs) == (0.5, 2.5)


def test_a_layer_inside_the_intro_or_the_outro_hangs_from_that_parts_boundaries():
    title = TextLayer("title", "Halo", start=0.5, secs=2.0)
    thanks = TextLayer("thanks", "Thanks", start=23.2, secs=1.5)
    layers = capture(wrapped(20, text_layers=[title, thanks]), [AnchorOverride(LayerKind.TEXT_LAYERS, "thanks", AnchorKind.START)]).layers

    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "title") == Anchor(Edge(Boundary.CLIP_START, 0.5), Edge(Boundary.MAIN_START, -0.5))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "thanks") == Anchor(Edge(Boundary.MAIN_END, 0.2), Edge(Boundary.MAIN_END, 1.7))


def test_a_3_s_intro_moves_the_hook_and_a_hand_made_text_layer_by_3_s():
    template = saved_from(wrapped(20, outro=0, hook_start=3.5, hook_secs=2.5))
    mine = TextLayer("mine", "Mine", start=5.0, secs=2.0)

    applied = apply(template, candidate(30, hook_start=1.0, text_layers=[mine]))

    change = applied.change
    assert [(layer.id, layer.start) for layer in change.text_layers] == [("mine", 8.0)]
    # The hook at the Template's distance from the Main Slot's start, as long as the Template's.
    assert (change.hook_start, change.hook_secs) == (3.5, 2.5)
    assert applied.notices == []


def test_an_implicit_single_segment_becomes_explicit_between_the_intro_and_outro():
    template = saved_from(wrapped(20))

    change = apply(template, candidate(30)).change

    assert change.segments == [
        replace(video("sting", STING, 3.0), template="brand"), Segment(WHOLE, 100.0, 130.0), replace(video("card", CARD, 2.0), template="brand"),
    ]
    assert change.transitions == []


@pytest.mark.parametrize("secs", [20, 75])
def test_a_music_bed_from_the_intros_start_to_the_outros_end_covers_the_whole_clip(secs):
    template = saved_from(wrapped(20, music=[bed(secs=25.0)]))

    [song] = apply(template, candidate(secs)).change.music

    assert (song.start, song.secs) == (0.0, 3.0 + secs + 2.0)


def test_reapplying_with_a_5_s_intro_replaces_the_3_s_one_and_moves_hand_made_layers_by_2_s_more():
    short, long = saved_from(wrapped(20, outro=0)), saved_from(wrapped(20, intro=5.0, outro=0), template_id="long")
    mine = TextLayer("mine", "Mine", start=5.0, secs=2.0)
    once = apply(short, candidate(30, text_layers=[mine])).change

    again = apply(long, candidate(30, segments=once.segments, transitions=once.transitions, text_layers=once.text_layers), {"brand": short, "long": long})

    assert [(segment.id, segment.end, segment.template) for segment in again.change.segments] == [("sting", 5.0, "long"), (WHOLE, 130.0, None)]
    assert [(layer.id, layer.start) for layer in again.change.text_layers] == [("mine", 10.0)]
    assert again.notices == []


def test_the_intros_and_outros_transitions_and_media_edits_travel_and_the_main_slots_joins_are_kept():
    source_edits = [WordEdit(1.0, "Halo", media=STING), WordEdit(105.0, "Kabar")]
    template = saved_from(wrapped(
        20, transitions=[Transition("sting", TransitionKind.WIPELEFT, 0.5), Transition("s1", secs=0.3)],
        word_edits=source_edits, cue_edits=[CueEdit(1.0, media=CARD, scale=1.5)],
    ))
    mine = Transition("a", TransitionKind.DIPCOLOUR, 0.4)
    own = [Segment("a", 200.0, 210.0), Segment("b", 220.0, 230.0)]
    hand_edits = [WordEdit(205.0, "Saya"), WordEdit(1.0, "Hai", media=STING)]

    change = apply(template, candidate(20, start=200.0, end=230.0, segments=own, transitions=[mine], word_edits=hand_edits)).change

    assert [segment.id for segment in change.segments] == ["sting", "a", "b", "card"]
    assert change.transitions == [
        Transition("sting", TransitionKind.WIPELEFT, 0.5, template="brand"), mine, Transition("b", secs=0.3, template="brand"),
    ]
    # The Candidate's own edit of the sting's Word stays: it was made by hand.
    assert change.word_edits == hand_edits
    assert change.cue_edits == [CueEdit(1.0, media=CARD, scale=1.5, template="brand")]


def test_no_template_takes_the_intro_and_outro_off_and_pulls_hand_made_layers_and_the_hook_back():
    template = saved_from(wrapped(20, hook_start=3.0, word_edits=[WordEdit(1.0, "Halo", media=STING)]))
    mine = TextLayer("mine", "Mine", start=5.0, secs=2.0)
    once = apply(template, candidate(30, text_layers=[mine])).change
    branded = candidate(
        30, segments=once.segments, transitions=once.transitions, word_edits=once.word_edits,
        text_layers=[*once.text_layers, TextLayer("early", "On the sting", start=1.0, secs=1.0)], hook_start=once.hook_start + 1,
    )

    applied = apply(None, branded, {"brand": template})

    change = applied.change
    assert [segment.id for segment in change.segments] == [WHOLE]
    assert (change.transitions, change.word_edits) == ([], [])
    assert [(layer.id, layer.start) for layer in change.text_layers] == [("mine", 5.0)]
    assert change.hook_start == 1.0
    assert applied.notices == ["1 layer made by hand over the intro removed."]


def test_an_intro_segment_changed_by_hand_is_counted_and_replaced():
    template = saved_from(wrapped(20))
    once = apply(template, candidate(30)).change
    louder = [replace(segment, volume=1.5) if segment.id == "sting" else segment for segment in once.segments]

    applied = apply(template, candidate(30, segments=louder, transitions=once.transitions), {"brand": template})

    assert [segment.volume for segment in applied.change.segments] == [1.0, 1.0, 1.0]
    assert applied.notices == ["1 Template item changed by hand replaced."]


# Style, look and text from the Candidate

WARM = Grade(Adjust(temperature=9000))
GREY = Grade(Adjust(saturation=-100))
ECHO = AudioEffect("echo", {"delay": 0.5, "decay": 0.4})
BLUR = VideoEffect("gaussian-blur", {"radius": 6})
HOUSE = StyleOverrides(caption={"size": 80})
MANUAL = Framing(Transform(x=400.0))


def styled(**edits):
    """A Candidate styled as a channel's: a house Style Preset, a Manual Layout, warm, quieter, its
    first Source Segment with the voice treatment, and a Kicker."""
    track = [Segment("s1", 100.0, 110.0, grade=GREY, audio_effects=[ECHO], video_effects=[BLUR]), Segment("s2", 120.0, 130.0)]
    return candidate(20, **{
        "segments": track, "preset_id": "house", "style_overrides": HOUSE, "layout": Layout.MANUAL, "framing": MANUAL,
        "grade": WARM, "source_volume": 0.6, "hook_kicker": "EPISODE BARU", **edits,
    })


def test_the_style_look_main_slot_treatment_and_kicker_are_captured():
    template = saved_from(styled())

    assert (template.preset_id, template.style_overrides, template.layout, template.framing) == ("house", HOUSE, Layout.MANUAL, MANUAL)
    assert (template.grade, template.source_volume, template.kicker) == (WARM, 0.6, "EPISODE BARU")
    # The Main Slot treatment is the first Source Segment's.
    assert template.treatment == Treatment(GREY, [BLUR], [ECHO])


def test_the_style_layout_grade_and_clip_volume_are_replaced():
    template = saved_from(styled())

    change = apply(template, candidate(30, preset_id="bold", style_overrides=StyleOverrides(hook={"size": 50}), grade=GREY)).change

    assert (change.preset_id, change.style_overrides, change.layout, change.framing) == ("house", HOUSE, Layout.MANUAL, MANUAL)
    assert (change.grade, change.source_volume) == (WARM, 0.6)


def test_the_treatment_reaches_every_source_segment_keeping_their_speed_and_fades():
    template = saved_from(candidate(20, segments=[video("sting", STING, 3.0), Segment("s1", 100.0, 120.0, grade=GREY, audio_effects=[ECHO], video_effects=[BLUR])]))
    own = [
        Segment("a", 200.0, 210.0, speed=2.0, fade_in=0.5),
        Segment("b", 220.0, 230.0, volume=1.5, fade_out=1.0, audio_effects=[AudioEffect("echo", {"delay": 0.2})]),
        Segment("c", 240.0, 250.0, reverse=True),
    ]

    change = apply(template, candidate(25, start=200.0, end=250.0, segments=own)).change

    [sting, *treated] = change.segments
    assert (sting.grade, sting.audio_effects) == (Grade(), [])
    assert treated == [replace(segment, grade=GREY, audio_effects=[ECHO], video_effects=[BLUR]) for segment in own]


def test_an_implicit_segment_is_made_explicit_to_take_the_treatment():
    template = saved_from(styled())

    [whole] = apply(template, candidate(30)).change.segments

    assert whole == Segment(WHOLE, 100.0, 130.0, grade=GREY, audio_effects=[ECHO], video_effects=[BLUR])


def test_the_kicker_is_replaced_only_when_the_template_has_one_and_the_hook_text_never():
    with_kicker, without = saved_from(styled()), saved_from(styled(hook_kicker=""))
    mine = candidate(30, hook_text="Aku *kaget*", hook_kicker="TERBONGKAR!")

    assert apply(with_kicker, mine).change.hook_kicker == "EPISODE BARU"
    assert apply(without, mine).change.hook_kicker is None
    assert apply(with_kicker, mine).change.hook_text is None


def test_no_template_leaves_the_style_look_and_kicker_as_they_are():
    template = saved_from(styled())
    once = apply(template, candidate(30)).change

    change = apply(None, candidate(30, segments=once.segments, preset_id="house", grade=WARM, hook_kicker="EPISODE BARU"), {"brand": template}).change

    assert (change.preset_id, change.style_overrides, change.layout, change.grade, change.source_volume, change.hook_kicker) == (None,) * 6


def test_template_fields_are_filled_from_the_candidate():
    card = TextLayer("card", "{title} | {kicker}", start=2.0, secs=3.0)
    quote = TextLayer("quote", "“{hook}”", start=6.0, secs=3.0)
    template = saved_from(styled(text_layers=[card, quote]))
    # Saved as typed.
    assert [layer.item.text for layer in template.layers.text_layers] == ["{title} | {kicker}", "“{hook}”"]
    mine = candidate(30, title="Rahasia dapur", hook_text="Aku *kaget* sekali")

    applied = apply(template, mine)

    assert [layer.text for layer in applied.change.text_layers] == ["Rahasia dapur | EPISODE BARU", "“Aku kaget sekali”"]
    assert applied.notices == []
    # Applied again, unchanged: nothing counts as changed by hand.
    again = apply(template, replace(mine, text_layers=applied.change.text_layers, segments=applied.change.segments), {"brand": template})
    assert again.notices == []


def test_an_empty_kicker_leaves_nothing_with_a_notice():
    template = saved_from(styled(hook_kicker="", text_layers=[TextLayer("card", "{kicker} {title}", start=2.0, secs=3.0)]))

    applied = apply(template, candidate(30, title="Rahasia dapur"))

    assert [layer.text for layer in applied.change.text_layers] == [" Rahasia dapur"]
    assert applied.notices == ["{kicker} left empty: this clip has no Kicker."]


# Through the API

URL = "/api/templates"
LOWER_THIRD = {"id": "name", "text": "Jeni", "start": 2.0, "secs": 3.0}
CALL_TO_ACTION = {"id": "cta", "text": "Follow", "start": 14.0, "secs": 4.0}
PLATE = {"id": "plate", "start": 0.0, "secs": 20.0, "style": {"fill": "#000000"}}


def added(client, job: dict, start: float, end: float) -> dict:
    response = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": start, "end": end})
    assert response.status_code == 201, response.text
    return response.json()


def branded(client, wait_for_status, llm) -> tuple[dict, dict]:
    """A Job in review, and a Candidate of it lasting 20 s with a lower-third, a call to action
    and a plate under the whole Clip."""
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    source = added(client, job, 600.0, 620.0)
    assert source["end"] - source["start"] == pytest.approx(20, abs=1)
    length = source["end"] - source["start"]
    source = patch(
        client, job, source,
        text_layers=[LOWER_THIRD, {**CALL_TO_ACTION, "start": length - 6}], shapes=[{**PLATE, "secs": length}],
    )
    return job, source


def saved(client, job: dict, candidate: dict, name: str = "Brand", **body) -> dict:
    response = client.post(URL, json={"name": name, "job_id": job["id"], "candidate_id": candidate["id"], **body})
    assert response.status_code == 201, response.text
    return response.json()


def applied(client, job: dict, template: dict, candidates: list[dict], **body) -> dict:
    ids = [candidate["id"] for candidate in candidates]
    response = client.post(f"/api/jobs/{job['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": ids, **body})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_capture_preview_gives_the_guessed_anchors_without_saving(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    response = client.post(f"{URL}/capture", json={"job_id": job["id"], "candidate_id": source["id"]})

    assert response.status_code == 200, response.text
    layers = response.json()["layers"]
    assert [layer["anchor"]["start"]["boundary"] for layer in layers["text_layers"]] == ["main_start", "main_end"]
    assert layers["shapes"][0]["anchor"]["end"]["boundary"] == "main_end"
    assert client.get(URL).json() == []


def test_templates_are_saved_listed_renamed_saved_over_and_deleted(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    template = saved(client, job, source, anchors=[{"kind": "text_layers", "id": "name", "anchor": "span"}])
    assert (template["name"], template["notices"]) == ("Brand", [])
    assert template["layers"]["text_layers"][0]["anchor"]["end"]["boundary"] == "main_end"
    assert [listed["id"] for listed in client.get(URL).json()] == [template["id"]]

    renamed = client.patch(f"{URL}/{template['id']}", json={"name": "Brand 2"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Brand 2"

    # Saved over from the draft of an edit, which isn't saved: the id is kept.
    over = client.put(
        f"{URL}/{template['id']}",
        json={"name": "Brand 3", "job_id": job["id"], "candidate_id": source["id"], "edits": {"text_layers": [LOWER_THIRD]}},
    )
    assert over.status_code == 200, over.text
    assert (over.json()["id"], over.json()["name"]) == (template["id"], "Brand 3")
    assert [layer["item"]["id"] for layer in over.json()["layers"]["text_layers"]] == ["name"]
    assert [listed["name"] for listed in client.get(URL).json()] == ["Brand 3"]
    assert len(candidates_of(client, job, source)["text_layers"]) == 2

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert client.get(URL).json() == []
    assert client.delete(f"{URL}/{template['id']}").status_code == 404
    assert client.patch(f"{URL}/{template['id']}", json={"name": "x"}).status_code == 404


def test_the_poster_is_the_drafts_frame_at_the_playhead_replaced_on_save_over_and_deleted_with_it(
    client, settings, from_episode, llm, wait_for_status
):
    job, source = branded(client, wait_for_status, llm)

    template = saved(client, job, source, poster_at=1.0)
    poster = client.get(f"{URL}/{template['id']}/poster")
    assert poster.status_code == 200, poster.text
    assert poster.headers["content-type"] == "image/png"
    # Kept beside the Template store, by the Template's id, at a card's size.
    path = settings.data_dir / POSTERS_DIR / f"{template['id']}.png"
    assert path.read_bytes() == poster.content
    [stream] = probe(settings, path)["streams"]
    assert (stream["width"], stream["height"]) == POSTER_SIZE

    # Saved over from a draft with a green card over the frame: the poster is drawn again from it.
    green = {"id": "card", "start": 0.0, "secs": 5.0, "transform": {"x": 540, "y": 960}, "style": {"width": 1080, "height": 1920, "fill": "#00FF00"}}
    over = client.put(
        f"{URL}/{template['id']}",
        json={"name": "Brand", "job_id": job["id"], "candidate_id": source["id"], "edits": {"shapes": [green]}, "poster_at": 1.0},
    )
    assert over.status_code == 200, over.text
    replaced = client.get(f"{URL}/{template['id']}/poster")
    assert replaced.status_code == 200 and replaced.content != poster.content
    assert pixels_of(settings, path)[POSTER_SIZE[1] // 2, POSTER_SIZE[0] // 2][1] > 200

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert not path.exists()
    assert client.get(f"{URL}/{template['id']}/poster").status_code == 404


def test_a_template_of_an_unknown_candidate_or_anchor_is_refused(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    assert client.post(URL, json={"name": "x", "job_id": job["id"], "candidate_id": "00000000"}).status_code == 404
    response = client.post(
        URL, json={"name": "x", "job_id": job["id"], "candidate_id": source["id"], "anchors": [{"kind": "shapes", "id": "gone", "anchor": "end"}]}
    )
    assert response.status_code == 422
    assert "no Shape gone" in response.json()["detail"]


def a_video(client, tmp_path) -> dict:
    """A 2 s video added to the Media Library."""
    path = make(tmp_path / "sting.mp4", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=30:duration=2", "-c:v", "libx264")
    response = client.post("/api/media", files={"file": ("sting.mp4", path.read_bytes(), "application/octet-stream")})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_template_wraps_each_candidate_in_its_intro_and_outro(client, tmp_path, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    sting = a_video(client, tmp_path)
    shown = {"media": sting["id"], "framing": {}}
    source = patch(client, job, source, segments=[
        {"id": "sting", "start": 0.0, "end": 1.5, **shown},
        {"id": "s1", "start": source["start"], "end": source["end"]},
        {"id": "card", "start": 0.0, "end": 1.0, **shown},
    ], transitions=[{"after": "sting", "kind": "fade", "secs": 0.5}], word_edits=[{"at": 0.5, "text": "Halo", "media": sting["id"]}])

    template = saved(client, job, source)
    assert ([s["id"] for s in template["intro"]["segments"]], template["intro"]["secs"]) == (["sting"], 1.5)
    assert ([s["id"] for s in template["outro"]["segments"]], template["outro"]["secs"]) == (["card"], 1.0)
    assert template["intro"]["join"]["kind"] == "fade"

    house = client.post("/api/presets", json={"name": "House", "join_transition": {"kind": "fadeblack"}})
    assert house.status_code == 201, house.text
    target = patch(client, job, added(client, job, 700.0, 712.0), preset_id=house.json()["id"])
    applied(client, job, template, [target])

    now = candidates_of(client, job, target)
    assert [(s["id"], s["template"]) for s in now["segments"]] == [("sting", template["id"]), ("main", None), ("card", template["id"])]
    # The Join Transition never applies at the intro's and outro's joins: only the Template's is there.
    assert [(t["after"], t["template"]) for t in now["transitions"]] == [("sting", template["id"])]
    assert [(e["at"], e["template"]) for e in now["word_edits"]] == [(0.5, template["id"])]

    # No Template takes them off: one plain Segment again.
    response = client.post(f"/api/jobs/{job['id']}/templates/apply", json={"template_id": None, "candidate_ids": [target["id"]]})
    assert response.status_code == 200, response.text
    plain = candidates_of(client, job, target)
    assert (plain["segments"], plain["transitions"], plain["word_edits"]) == ([], [], [])
    assert (plain["start"], plain["end"]) == (target["start"], target["end"])


def test_a_music_bed_applied_to_a_longer_candidate_stops_at_its_songs_end(client, tmp_path, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    path = make(tmp_path / "bed.wav", "-f", "lavfi", "-i", "sine=frequency=330:duration=30")
    song = client.post("/api/media", files={"file": ("bed.wav", path.read_bytes(), "application/octet-stream")}).json()
    length = source["end"] - source["start"]
    source = patch(client, job, source, music=[{"id": "bed", "media": song["id"], "start": 0.0, "secs": round(length, 2)}])
    template = saved(client, job, source)
    target = added(client, job, 800.0, 875.0)

    [entry] = applied(client, job, template, [target])["candidates"]

    [bed] = candidates_of(client, job, target)["music"]
    assert bed["secs"] == pytest.approx(song["duration"], abs=0.01)
    assert "1 Music Clip stopped at its song's end: a song never loops." in entry["notices"]


def test_a_template_of_a_candidate_with_no_segment_of_the_source_is_refused(client, tmp_path, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    sting = a_video(client, tmp_path)

    response = client.post(URL, json={
        "name": "x", "job_id": job["id"], "candidate_id": source["id"],
        "edits": {"segments": [{"id": "sting", "start": 0.0, "end": 1.5, "media": sting["id"], "framing": {}}]},
    })

    assert response.status_code == 422
    assert "Segment of the episode" in response.json()["detail"]
    assert client.get(URL).json() == []


def candidates_of(client, job: dict, candidate: dict) -> dict:
    [found] = [c for c in candidates(client, job) if c["id"] == candidate["id"]]
    return found


def test_applying_to_three_candidates_changes_each_by_one_revision_in_one_request(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    targets = [added(client, job, 700.0, 712.0), added(client, job, 800.0, 875.0), source]

    result = applied(client, job, template, targets)

    assert [entry["candidate_id"] for entry in result["candidates"]] == [target["id"] for target in targets]
    for target, entry in zip(targets, result["candidates"]):
        now = candidates_of(client, job, target)
        length = now["end"] - now["start"]
        assert now["revision"] == target["revision"] + 1 == entry["revision"]
        assert entry["edits"]["text_layers"] == now["text_layers"]
        name, cta = [layer for layer in now["text_layers"] if layer["template"] == template["id"]]
        assert (name["start"], name["secs"]) == (2.0, 3.0)
        assert cta["start"] + cta["secs"] == pytest.approx(length - 2, abs=0.01)
        [plate] = [shape for shape in now["shapes"] if shape["template"] == template["id"]]
        assert plate["secs"] == pytest.approx(length, abs=0.01)
        history = client.get(f"/api/jobs/{job['id']}/candidates/{target['id']}/revisions").json()
        newest = history["revisions"][0]
        assert (newest["revision"], newest["parts"]) == (now["revision"], ["Text Layers", "Shapes"])
    # Its own hand-made layers became Template items' copies beside them: none of them is marked.
    assert [layer["template"] for layer in candidates_of(client, job, source)["text_layers"]] == [None, None, template["id"], template["id"]]


def test_a_dry_run_saves_nothing(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)

    result = applied(client, job, template, [target], dry_run=True)

    [entry] = result["candidates"]
    assert entry["revision"] == target["revision"]
    assert [layer["template"] for layer in entry["edits"]["text_layers"]] == [template["id"]] * 2
    assert candidates_of(client, job, target) == target


def test_reapplying_counts_items_changed_by_hand_and_no_template_takes_them_off(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)
    applied(client, job, template, [target])
    now = candidates_of(client, job, target)
    moved = [{**layer, "start": layer["start"] + 0.5} if layer["id"] == "name" else layer for layer in now["text_layers"]]
    mine = {"id": "mine", "text": "Mine", "start": 1.0, "secs": 1.0}
    patch(client, job, now, text_layers=[*moved, mine])

    [again] = applied(client, job, template, [target])["candidates"]

    assert again["notices"] == ["1 Template item changed by hand replaced."]
    assert [(layer["id"], layer["template"]) for layer in again["edits"]["text_layers"]] == [
        ("mine", None), ("name", template["id"]), ("cta", template["id"]),
    ]

    response = client.post(f"/api/jobs/{job['id']}/templates/apply", json={"template_id": None, "candidate_ids": [target["id"]]})
    assert response.status_code == 200, response.text
    assert response.json()["candidates"][0]["notices"] == []
    plain = candidates_of(client, job, target)
    assert [layer["id"] for layer in plain["text_layers"]] == ["mine"]
    assert plain["shapes"] == []

    # Its Template deleted, a Template item counts as replaced.
    applied(client, job, template, [target])
    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    response = client.post(f"/api/jobs/{job['id']}/templates/apply", json={"template_id": None, "candidate_ids": [target["id"]]})
    assert response.json()["candidates"][0]["notices"] == ["3 Template items of a deleted Template removed."]


def test_an_unknown_candidate_fails_the_whole_batch(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)

    response = client.post(
        f"/api/jobs/{job['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": [target["id"], "00000000"]}
    )

    assert response.status_code == 404
    assert candidates_of(client, job, target) == target
    unknown = {"template_id": "nope", "candidate_ids": [target["id"]]}
    assert client.post(f"/api/jobs/{job['id']}/templates/apply", json=unknown).status_code == 404


def test_a_job_not_in_review_is_refused(client, video_source, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)

    video_source.hold()
    try:
        running = create_job(client)
        wait_for_status(running["id"], "downloading")
        for dry_run in (False, True):
            response = client.post(
                f"/api/jobs/{running['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": ["x"], "dry_run": dry_run}
            )
            assert response.status_code == 409
            assert "while it is in review" in response.json()["detail"]
    finally:
        video_source.release()


def test_a_template_carries_the_style_and_one_whose_style_preset_was_deleted_applies_default(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    house = client.post("/api/presets", json={"name": "House", "caption": {"active_colour": "#00AAFF", "size": 90}})
    assert house.status_code == 201, house.text
    card = {"id": "card", "text": "{kicker}: {title}", "start": 0.5, "secs": 2.0}
    source = patch(
        client, job, source, preset_id=house.json()["id"], style_overrides={"caption": {"position": "top"}}, layout="blur",
        source_volume=0.5, hook_kicker="EPISODE BARU", text_layers=[card],
    )
    template = saved(client, job, source)
    assert (template["preset_id"], template["kicker"]) == (house.json()["id"], "EPISODE BARU")
    assert template["layers"]["text_layers"][0]["item"]["text"] == "{kicker}: {title}"
    target = patch(client, job, added(client, job, 700.0, 712.0), hook_text="Aku *kaget*")
    assert client.delete(f"/api/presets/{house.json()['id']}").status_code == 204

    applied(client, job, template, [target])

    now = candidates_of(client, job, target)
    assert (now["layout"], now["source_volume"], now["hook_kicker"], now["hook_text"]) == ("blur", 0.5, "EPISODE BARU", "Aku *kaget*")
    assert [layer["text"] for layer in now["text_layers"]] == [f"EPISODE BARU: {now['title']}"]
    planned = client.post(f"/api/jobs/{job['id']}/candidates/{target['id']}/preview-plan")
    assert planned.status_code == 200, planned.text
    caption = planned.json()["plan"]["caption_style"]
    # Default's, the House Preset being gone, with the Template's Style Overrides.
    assert (caption["active_colour"], caption["size"], caption["position"]) == ("#FF9F0A", 110, "top")


def test_a_candidates_marks_are_kept_through_edits_and_one_saved_before_marks_loads_unchanged(
    client, settings, from_episode, llm, wait_for_status
):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)
    applied(client, job, template, [target])

    now = candidates_of(client, job, target)
    edited = patch(client, job, now, hook_text="Edited", text_layers=now["text_layers"])
    assert [layer["template"] for layer in edited["text_layers"]] == [template["id"]] * 2

    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    stored = json.loads(path.read_text())
    for candidate in stored:
        for kind in ("text_layers", "shapes", "music", "overlays", "adjustment_layers"):
            candidate[kind] = [{k: v for k, v in item.items() if k != "template"} for item in candidate[kind]]
    path.write_text(json.dumps(stored))
    unmarked = candidates_of(client, job, source)
    assert unmarked["revision"] == source["revision"]
    assert [layer["template"] for layer in unmarked["text_layers"]] == [None, None]


# Library guards (.scratch/templates/issues/09-library-guards.md)


@pytest.fixture(scope="session")
def song(tmp_path_factory) -> bytes:
    """3 s of a 440 Hz tone."""
    return make(tmp_path_factory.mktemp("song") / "song.wav", "-f", "lavfi", "-i", "sine=frequency=440:duration=3").read_bytes()


def test_a_template_naming_a_missing_media_item_or_face_is_refused(client, settings, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    body = {"name": "x", "job_id": job["id"], "candidate_id": source["id"]}
    gone = {"id": "bed", "media": "cd" * 16, "start": 0.0, "secs": 1.0}
    unknown_face = {**LOWER_THIRD, "style": {"font": "no-such-face"}}

    for edits in ({"music": [gone]}, {"text_layers": [unknown_face]}, {"style_overrides": {"watermark": {"kind": "logo", "logo": "ab" * 16}}}):
        response = client.post(URL, json={**body, "edits": edits})
        assert response.status_code == 422, edits
    # Nor from a Candidate that holds one already, as saved.
    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    stored = json.loads(path.read_text())
    [held] = [candidate for candidate in stored if candidate["id"] == source["id"]]
    held["music"] = [gone]
    path.write_text(json.dumps(stored))
    response = client.post(URL, json=body)
    assert response.status_code == 422 and "cd" * 16 in response.json()["detail"], response.text
    assert client.get(URL).json() == []


def test_a_song_look_or_face_used_only_by_a_template_cant_be_deleted_until_it_is(
    client, from_episode, llm, wait_for_status, song
):
    item = upload_media(client, song, "song.wav").json()
    look = imported_look(client)
    face = imported_face(client, font_file("Testp"))["faces"][0]
    job, source = branded(client, wait_for_status, llm)
    branded_with = patch(
        client, job, source,
        music=[{"id": "bed", "media": item["id"], "start": 0.0, "secs": 1.0}],
        adjustment_layers=[{"id": "warm", "start": 0.0, "secs": 2.0, "grade": {"look": look["id"]}}],
        text_layers=[{**LOWER_THIRD, "style": {"font": face["id"]}}],
    )
    template = saved(client, job, branded_with)
    # Its Job, and with it the Candidate and its Revision History, is gone: only the Template uses them.
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204

    for url in (f"/api/media/{item['id']}", f"/api/looks/{look['id']}", f"/api/fonts/{face['id']}"):
        refused = client.delete(url)
        assert refused.status_code == 409, url
        detail = refused.json()["detail"]
        assert "Template Brand" in detail["message"], detail
        [use] = detail["uses"]
        assert (use["kind"], use["title"]) == ("template", "Brand"), use
        assert use.get("template_id", use.get("id")) == template["id"]

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    for url in (f"/api/media/{item['id']}", f"/api/looks/{look['id']}", f"/api/fonts/{face['id']}"):
        assert client.delete(url).status_code == 204, url


def test_a_templates_logo_can_be_deleted_and_it_then_applies_with_no_watermark(
    client, from_episode, llm, wait_for_status, red_logo
):
    logo = upload_logo(client, red_logo).json()
    job, source = branded(client, wait_for_status, llm)
    watermark = {"style_overrides": {"watermark": {"kind": "logo", "logo": logo["id"]}}}
    template = saved(client, job, source, edits=watermark)
    assert template["style_overrides"]["watermark"]["logo"] == logo["id"]
    shown = added(client, job, 700.0, 712.0)
    applied(client, job, template, [shown])
    assert preview(client, job, candidates_of(client, job, shown))["plan"]["watermark"] is not None

    # The Logo isn't held by the Template: it goes, and the Template's style then shows no Watermark.
    assert client.delete(f"/api/logos/{logo['id']}").status_code == 204
    target = added(client, job, 800.0, 812.0)
    applied(client, job, template, [target])
    now = candidates_of(client, job, target)
    assert now["style_overrides"]["watermark"]["logo"] == logo["id"]
    assert preview(client, job, now)["plan"]["watermark"] is None


def test_a_template_whose_intro_or_style_names_a_missing_item_is_refused(
    client, settings, tmp_path, from_episode, llm, wait_for_status
):
    job, source = branded(client, wait_for_status, llm)
    sting = a_video(client, tmp_path)
    source = patch(client, job, source, segments=[
        {"id": "sting", "start": 0.0, "end": 1.5, "media": sting["id"], "framing": {}},
        {"id": "s1", "start": source["start"], "end": source["end"]},
    ], transitions=[])
    body = {"name": "x", "job_id": job["id"], "candidate_id": source["id"]}
    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    original = path.read_text()

    def held(change) -> None:
        stored = json.loads(original)
        [candidate] = [c for c in stored if c["id"] == source["id"]]
        change(candidate)
        path.write_text(json.dumps(stored))

    gone = "cd" * 16
    changes = {
        gone: lambda c: c["segments"][0].update(media=gone),
        "no-such-look": lambda c: c["segments"][1].update(grade={"look": "no-such-look"}),
        "no-such-face": lambda c: c["style_overrides"]["caption"].update(font="no-such-face"),
    }
    for missing, change in changes.items():
        held(change)
        response = client.post(URL, json=body)
        assert response.status_code == 422, missing
        assert missing in response.json()["detail"], response.text
    assert client.get(URL).json() == []


def test_a_video_used_only_as_a_templates_intro_cant_be_deleted_until_it_is(
    client, tmp_path, from_episode, llm, wait_for_status
):
    job, source = branded(client, wait_for_status, llm)
    sting = a_video(client, tmp_path)
    source = patch(client, job, source, segments=[
        {"id": "sting", "start": 0.0, "end": 1.5, "media": sting["id"], "framing": {}},
        {"id": "s1", "start": source["start"], "end": source["end"]},
    ], transitions=[])
    template = saved(client, job, source)
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204

    refused = client.delete(f"/api/media/{sting['id']}")
    assert refused.status_code == 409
    [use] = refused.json()["detail"]["uses"]
    assert (use["kind"], use["title"], use.get("template_id", use.get("id"))) == ("template", "Brand", template["id"])

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert client.delete(f"/api/media/{sting['id']}").status_code == 204


def test_a_look_used_only_by_a_templates_main_slot_treatment_cant_be_deleted(client, from_episode, llm, wait_for_status):
    look = imported_look(client)
    job, source = branded(client, wait_for_status, llm)
    source = patch(client, job, source, segments=[
        {"id": "s1", "start": source["start"], "end": source["end"], "grade": {"look": look["id"]}},
    ])
    template = saved(client, job, source)
    assert template["treatment"]["grade"]["look"] == look["id"]
    assert template["grade"]["look"] is None
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204

    refused = client.delete(f"/api/looks/{look['id']}")
    assert refused.status_code == 409
    assert "Template Brand" in refused.json()["detail"]["message"]

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert client.delete(f"/api/looks/{look['id']}").status_code == 204


def test_a_face_used_only_by_a_templates_style_overrides_cant_be_deleted(client, from_episode, llm, wait_for_status):
    face = imported_face(client, font_file("Testp"))["faces"][0]
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source, edits={"style_overrides": {"hook": {"font": face["id"]}}})
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204

    refused = client.delete(f"/api/fonts/{face['id']}")
    assert refused.status_code == 409
    [use] = refused.json()["detail"]["uses"]
    assert (use["kind"], use["parts"]) == ("template", ["hook style"])

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert client.delete(f"/api/fonts/{face['id']}").status_code == 204


# Through MCP


@pytest.mark.anyio
async def test_list_presets_gives_a_templates_intro_and_outro_lengths(mcp, tmp_path):
    video = make(tmp_path / "sting.mp4", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=30:duration=2", "-c:v", "libx264")
    sting = await call(mcp, "add_asset", kind="media", path=str(video))
    job = await reviewed(mcp)
    source = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": source["id"]}
    shown = {"media": sting["id"], "framing": {}}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [
        {"id": "sting", "start": 0.0, "end": 1.5, **shown},
        {"id": "s1", "start": source["start"], "end": source["end"]},
        {"id": "card", "start": 0.0, "end": 1.0, **shown},
    ], "transitions": []})
    template = await call(mcp, "save_preset", kind="template", preset={"name": "Brand", **ids})

    [listed] = (await call(mcp, "list_presets", kind="template"))["presets"]
    assert (listed["intro_secs"], listed["outro_secs"]) == (1.5, 1.0)

    target = await manual(mcp, job, *HALO_KABAR)
    [entry] = (await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"]))["candidates"]
    assert [(item["kind"], item["id"]) for item in entry["template_items"]] == [("segments", "sting"), ("segments", "card")]



@pytest.mark.anyio
async def test_templates_are_saved_listed_with_their_anchors_applied_and_deleted_through_mcp(mcp):
    job = await reviewed(mcp)
    source = await manual(mcp, job, *HALO_KABAR)
    length = source["end"] - source["start"]
    ids = {"job_id": job["id"], "candidate_id": source["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"text_layers": [
        {"id": "name", "text": "{kicker}", "start": 0.1, "secs": 0.3},
        {"id": "cta", "text": "Follow", "start": length - 0.5, "secs": 0.4},
    ], "hook_kicker": "BARU", "layout": "split"})

    template = await call(mcp, "save_preset", kind="template", preset={
        "name": "Brand", **ids, "anchors": [{"kind": "text_layers", "id": "cta", "anchor": "span"}],
    })
    assert template["name"] == "Brand"
    [listed] = (await call(mcp, "list_presets", kind="template"))["presets"]
    assert (listed["id"], listed["name"]) == (template["id"], "Brand")
    assert [(layer["kind"], layer["id"], layer["anchor"]) for layer in listed["layers"]] == [
        ("text_layers", "name", "start"), ("text_layers", "cta", "span"),
    ]
    # Its Template Fields as typed, and its style.
    assert listed["layers"][0]["text"] == "{kicker}"
    assert (listed["preset_id"], listed["layout"], listed["kicker"]) == ("default", "split", "BARU")
    assert listed["layers"][0]["edges"] == [{"boundary": "main_start", "offset": 0.1}, {"boundary": "main_start", "offset": 0.4}]

    # Saved over by its id, which is kept; renamed alone.
    over = await call(mcp, "save_preset", kind="template", preset_id=template["id"], preset={"name": "Brand 2", **ids})
    assert (over["id"], over["name"]) == (template["id"], "Brand 2")
    assert (await call(mcp, "save_preset", kind="template", preset_id=template["id"], preset={"name": "Brand 3"}))["name"] == "Brand 3"

    target = await manual(mcp, job, *HALO_KABAR)
    dry = await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"], dry_run=True)
    [entry] = dry["candidates"]
    assert [layer["template"] for layer in entry["edits"]["text_layers"]] == [template["id"]] * 2
    assert (await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"]))["text_layers"] == []

    await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"])
    shown = await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"])
    marked = shown["text_layers"]
    assert [(layer["id"], layer["template"]) for layer in marked] == [("name", template["id"]), ("cta", template["id"])]
    # Filled on the Candidate.
    assert (marked[0]["text"], shown["layout"], shown["hook_kicker"]) == ("BARU", "split", "BARU")

    shown = await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"])
    assert shown["template_items"] == [
        {"kind": "text_layers", "id": "name", "template_id": template["id"], "template": "Brand 3"},
        {"kind": "text_layers", "id": "cta", "template_id": template["id"], "template": "Brand 3"},
    ]
    # The dry run of another application lists the marks it would leave, and what it tells.
    [entry] = (await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"], dry_run=True))["candidates"]
    assert [item["template"] for item in entry["template_items"]] == ["Brand 3", "Brand 3"]
    assert entry["notices"] == []

    assert await call(mcp, "delete_preset", kind="template", preset_id=template["id"]) == {"deleted": template["id"]}
    shown = await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"])
    assert [item["template"] for item in shown["template_items"]] == ["deleted", "deleted"]
    # No Template takes them off.
    [entry] = (await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=None, dry_run=True))["candidates"]
    assert (entry["template_items"], entry["notices"]) == ([], ["2 Template items of a deleted Template removed."])
    await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=None)
    shown = await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"])
    assert shown["text_layers"] == [] and "template_items" not in shown
    assert (await call(mcp, "list_presets", kind="template"))["presets"] == []
    assert "No Template" in await fails(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"])
