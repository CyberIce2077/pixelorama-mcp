extends RefCounted
## The commands the MCP server can run. Each one takes the request params and
## returns a Dictionary; failures return {"error": "..."}.
##
## Pixelorama counts frames from left to right and layers from bottom to top,
## both starting at 0. Drawing goes through ExtensionsApi.project.set_pixelcel_image,
## so every change is a single undo step in Pixelorama.

const LAYER_TYPES := ["pixel", "group", "3d", "tilemap", "audio"]
const MAX_READ_PIXELS := 128 * 128
## Characters used to label colors in read_pixels. "." is reserved for transparent.
const SYMBOLS := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@$%&*+=-~^<>?!:;/|"

var api: Node


func _init(extensions_api: Node) -> void:
	api = extensions_api


func run(method: String, params: Dictionary) -> Dictionary:
	var command := "_cmd_" + method
	if method.is_empty() or not has_method(command):
		return _error("Unknown method: %s" % method)
	return call(command, params)


func _cmd_get_project(_params: Dictionary) -> Dictionary:
	var global = api.general.get_global()
	var project = global.current_project
	var layers := []
	for i in project.layers.size():
		var layer = project.layers[i]
		layers.append({
			"index": i,
			"name": layer.name,
			"type": LAYER_TYPES[layer.get_layer_type()],
			"visible": layer.visible,
			"locked": layer.locked,
		})
	var open_projects := []
	for p in global.projects:
		open_projects.append(p.name)
	return {
		"name": project.name,
		"width": project.size.x,
		"height": project.size.y,
		"frames": project.frames.size(),
		"fps": project.fps,
		"layers": layers,
		"current_frame": project.current_frame,
		"current_layer": project.current_layer,
		"save_path": project.save_path,
		"open_projects": open_projects,
	}


func _cmd_new_project(params: Dictionary) -> Dictionary:
	var width := int(params.get("width", 64))
	var height := int(params.get("height", 64))
	if width < 1 or height < 1 or width > 4096 or height > 4096:
		return _error("Size must be between 1 and 4096 pixels")
	# new_project() only accepts a typed Array[Frame]. The Frame class can't be
	# named from an extension, so take an empty copy of an existing frames array.
	var no_frames: Array = api.project.current_project.frames.duplicate()
	no_frames.clear()
	var project = api.project.new_project(no_frames, str(params.get("name", "untitled")), Vector2(width, height))
	if project == null:
		return _error("Pixelorama could not create the project")
	api.project.current_project = project
	return _cmd_get_project({})


func _cmd_open_file(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	if not FileAccess.file_exists(path):
		return _error("File not found: %s" % path)
	var open_save = api.import.open_save_autoload()
	match path.get_extension().to_lower():
		"pxo":
			open_save.open_pxo_file(path)
		"png", "jpg", "jpeg", "webp", "bmp", "tga":
			var image := Image.load_from_file(path)
			if image == null:
				return _error("Cannot load image: %s" % path)
			open_save.open_image_as_new_tab(path, image)
		_:
			return _error("Only .pxo files and images can be opened")
	return _cmd_get_project({})


func _cmd_draw_pixels(params: Dictionary) -> Dictionary:
	var target := _target_cel(params)
	if target.has("error"):
		return target

	var palette := {}
	var raw_palette = params.get("palette", {})
	if not raw_palette is Dictionary or raw_palette.is_empty():
		return _error("palette must map single characters to colors")
	for key in raw_palette:
		if str(key).length() != 1:
			return _error("Palette keys must be single characters, got '%s'" % key)
		var color := _parse_color(str(raw_palette[key]))
		if color.is_empty():
			return _error("Invalid color for '%s': %s" % [key, raw_palette[key]])
		palette[str(key)] = color[0]

	var image: Image = target.image
	var bounds := Rect2i(Vector2i.ZERO, image.get_size())
	var origin := Vector2i(int(params.get("x", 0)), int(params.get("y", 0)))
	var rows: Array = params.get("rows", [])
	var changed := 0
	var unknown := {}
	for y in rows.size():
		var row := str(rows[y])
		for x in row.length():
			var symbol := row[x]
			if not palette.has(symbol):
				if symbol != "." and symbol != " ":
					unknown[symbol] = true
				continue
			var pos := origin + Vector2i(x, y)
			if bounds.has_point(pos):
				image.set_pixelv(pos, palette[symbol])
				changed += 1

	_commit(target, image)
	var result := {"frame": target.frame, "layer": target.layer, "pixels_changed": changed}
	if not unknown.is_empty():
		result.ignored_characters = "".join(PackedStringArray(unknown.keys()))
	return result


func _cmd_fill_rect(params: Dictionary) -> Dictionary:
	var target := _target_cel(params)
	if target.has("error"):
		return target
	var color := _parse_color(str(params.get("color", "")))
	if color.is_empty():
		return _error("Invalid color: %s" % params.get("color"))

	var image: Image = target.image
	var rect := _rect_param(params, image.get_size())
	if rect.has_area():
		image.fill_rect(rect, color[0])
	_commit(target, image)
	return {"frame": target.frame, "layer": target.layer, "pixels_changed": rect.get_area()}


func _cmd_read_pixels(params: Dictionary) -> Dictionary:
	var target := _target_cel(params, false)
	if target.has("error"):
		return target
	var image: Image = target.image
	var rect := _rect_param(params, image.get_size())
	if rect.get_area() > MAX_READ_PIXELS:
		return _error("Area too large (%d pixels, max %d). Read it in parts." % [rect.get_area(), MAX_READ_PIXELS])

	var symbols := {}
	var palette := {}
	var rows := []
	for y in range(rect.position.y, rect.end.y):
		var row := ""
		for x in range(rect.position.x, rect.end.x):
			var color := image.get_pixel(x, y)
			if color.a == 0:
				row += "."
				continue
			var html := "#" + color.to_html(color.a < 1)
			if not symbols.has(html):
				if symbols.size() == SYMBOLS.length():
					return _error("More than %d colors in this area. Read a smaller part." % SYMBOLS.length())
				var symbol := SYMBOLS[symbols.size()]
				symbols[html] = symbol
				palette[symbol] = html
			row += symbols[html]
		rows.append(row)
	return {
		"frame": target.frame,
		"layer": target.layer,
		"x": rect.position.x,
		"y": rect.position.y,
		"palette": palette,
		"rows": rows,
	}


func _cmd_get_image(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	if frame < 0 or frame >= project.frames.size():
		return _error("Frame %d does not exist" % frame)
	var image := _blend_frame(project, frame)
	var scale := int(params.get("scale", 0))
	if scale <= 0:
		scale = maxi(1, 512 / maxi(image.get_width(), image.get_height()))
	if scale > 1:
		image.resize(image.get_width() * scale, image.get_height() * scale, Image.INTERPOLATE_NEAREST)
	return {"png": Marshalls.raw_to_base64(image.save_png_to_buffer()), "frame": frame, "scale": scale}


func _cmd_add_layer(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var above := int(params.get("above", project.layers.size() - 1))
	if above < 0 or above >= project.layers.size():
		return _error("Layer %d does not exist" % above)
	api.project.add_new_layer(above, str(params.get("name", "")))
	api.project.select_cels([[project.current_frame, above + 1]])
	return _cmd_get_project({})


func _cmd_add_frame(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var after := int(params.get("after", project.frames.size() - 1))
	if after < 0 or after >= project.frames.size():
		return _error("Frame %d does not exist" % after)
	api.project.add_new_frame(after)
	api.project.select_cels([[after + 1, project.current_layer]])
	return _cmd_get_project({})


func _cmd_select_cel(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	var layer := int(params.get("layer", project.current_layer))
	if frame < 0 or frame >= project.frames.size() or layer < 0 or layer >= project.layers.size():
		return _error("No cel at frame %d, layer %d" % [frame, layer])
	api.project.select_cels([[frame, layer]])
	return _cmd_get_project({})


func _cmd_save_project(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var path := str(params.get("path", project.save_path))
	if path.is_empty():
		return _error("The project has never been saved, so a path is required")
	if not path.is_absolute_path() or path.get_extension().to_lower() != "pxo":
		return _error("path must be an absolute path ending in .pxo")
	if not api.import.open_save_autoload().save_pxo_file(path, false):
		return _error("Saving failed")
	return {"path": path}


func _cmd_export_png(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var path := str(params.get("path", ""))
	if not path.is_absolute_path() or path.get_extension().to_lower() != "png":
		return _error("path must be an absolute path ending in .png")

	var frames := []
	if params.get("all_frames", false):
		frames = range(project.frames.size())
	else:
		var frame := int(params.get("frame", project.current_frame))
		if frame < 0 or frame >= project.frames.size():
			return _error("Frame %d does not exist" % frame)
		frames = [frame]

	# All frames are laid out left to right as a sprite sheet.
	var size: Vector2i = project.size
	var sheet := Image.create(size.x * frames.size(), size.y, false, Image.FORMAT_RGBA8)
	for i in frames.size():
		var image := _blend_frame(project, frames[i])
		image.convert(Image.FORMAT_RGBA8)
		sheet.blit_rect(image, Rect2i(Vector2i.ZERO, size), Vector2i(size.x * i, 0))

	var scale := maxi(1, int(params.get("scale", 1)))
	if scale > 1:
		sheet.resize(sheet.get_width() * scale, sheet.get_height() * scale, Image.INTERPOLATE_NEAREST)
	var err := sheet.save_png(path)
	if err != OK:
		return _error("Cannot write %s: %s" % [path, error_string(err)])
	return {"path": path, "width": sheet.get_width(), "height": sheet.get_height(), "frames": frames.size()}


## Finds the cel a drawing command works on (current cel unless frame/layer are given)
## and returns a copy of its image to modify.
func _target_cel(params: Dictionary, for_writing := true) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	var layer := int(params.get("layer", project.current_layer))
	if frame < 0 or frame >= project.frames.size():
		return _error("Frame %d does not exist" % frame)
	if layer < 0 or layer >= project.layers.size():
		return _error("Layer %d does not exist" % layer)

	var cel = project.frames[frame].cels[layer]
	if cel.get_class_name() != "PixelCel":
		return _error("Layer %d is not a pixel layer" % layer)
	if for_writing and project.layers[layer].locked:
		return _error("Layer %d is locked" % layer)

	var image := Image.new()
	image.copy_from(cel.get_image())
	return {"frame": frame, "layer": layer, "image": image}


func _commit(target: Dictionary, image: Image) -> void:
	api.project.set_pixelcel_image(image, target.frame, target.layer)


func _blend_frame(project, frame: int) -> Image:
	var image: Image = project.new_empty_image()
	api.general.get_drawing_algos().blend_layers(image, project.frames[frame], Vector2i.ZERO, project)
	return image


func _rect_param(params: Dictionary, size: Vector2i) -> Rect2i:
	var x := int(params.get("x", 0))
	var y := int(params.get("y", 0))
	var rect := Rect2i(x, y, int(params.get("width", size.x - x)), int(params.get("height", size.y - y)))
	return rect.intersection(Rect2i(Vector2i.ZERO, size))


## Returns [color] or [] when the text is not a color.
## Accepts #rgb, #rrggbb, #rrggbbaa, color names and "transparent".
func _parse_color(text: String) -> Array:
	text = text.strip_edges()
	if text.to_lower() == "transparent":
		return [Color(0, 0, 0, 0)]
	if Color.html_is_valid(text):
		return [Color.html(text)]
	var named := Color.from_string(text, Color(0, 0, 0, -1))
	if named.a < 0:
		return []
	return [named]


func _error(message: String) -> Dictionary:
	return {"error": message}
