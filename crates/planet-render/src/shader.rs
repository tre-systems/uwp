use std::borrow::Cow;

pub fn shader_with_common(source: &'static str) -> wgpu::ShaderSource<'static> {
    wgpu::ShaderSource::Wgsl(Cow::Owned(format!(
        "{}\n{}",
        include_str!("shaders/common.wgsl"),
        expand_includes(source)
    )))
}

fn expand_includes(source: &'static str) -> String {
    source.replace(
        "#include \"chunks/agx.wgsl\"",
        include_str!("shaders/chunks/agx.wgsl"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shaders_parse_and_validate() {
        for (name, source) in [
            ("planet.wgsl", include_str!("shaders/planet.wgsl")),
            ("background.wgsl", include_str!("shaders/background.wgsl")),
            ("atmosphere.wgsl", include_str!("shaders/atmosphere.wgsl")),
            ("system.wgsl", include_str!("shaders/system.wgsl")),
        ] {
            let mut validator = naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::empty(),
            );
            let combined = match shader_with_common(source) {
                wgpu::ShaderSource::Wgsl(source) => source,
                _ => unreachable!("shader_with_common only returns WGSL"),
            };
            let module = naga::front::wgsl::parse_str(&combined)
                .unwrap_or_else(|err| panic!("{name} failed WGSL parsing: {err}"));
            validator
                .validate(&module)
                .unwrap_or_else(|err| panic!("{name} failed WGSL validation: {err}"));
        }
    }
}
